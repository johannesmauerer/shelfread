"use node";

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ExtractedContent, DesignProfile } from "./types";

export type { ExtractedContent, DesignProfile };

const EXTRACTION_PROMPT = `You are an expert at extracting newsletter content from HTML emails.

# THIS IS A VERBATIM EXTRACTION TASK — NOT SUMMARIZATION

Your single most important job is to reproduce the article body COMPLETELY and WORD FOR WORD. You are a transcriber, not an editor. Copy every sentence of the author's prose exactly as written. Copy every item in every list. Copy every reader submission, every recommendation, every aside, every paragraph of commentary.

Do NOT summarize. Do NOT shorten. Do NOT paraphrase. Do NOT keep only the first sentence of a section and drop the rest. Do NOT condense a multi-sentence item down to its headline. If the author wrote three sentences about a product, output all three sentences. If a "links" or "recommendations" section has ten entries, output all ten — never a representative subset.

A correct extraction contains the same words the reader would see if they read the original email in full, minus only the chrome listed below. Dropping a single sentence of real content is a failure.

# CRITICAL OUTPUT RULE — read this too, apply throughout

The HTML you produce in \`content_html\` will be rendered inside an EPUB reader that switches between light and dark mode. The EPUB has its own stylesheet that adapts to both. Inline color/background declarations in your output OVERRIDE that stylesheet and cause unreadable contrast (e.g. black text on a black dark-mode background).

Therefore, in EVERY \`style="..."\` attribute you emit, you MUST remove these three properties:
- \`color\`
- \`background\`
- \`background-color\`

Keep all other style properties (margin, padding, font-size, line-height, text-align, font-family, font-weight, border-*, display, width, height, etc.).

If removing those three properties leaves the style attribute empty or with only whitespace/semicolons, omit the \`style\` attribute entirely.

You must ALSO remove these legacy attributes wherever they appear: \`color="..."\`, \`bgcolor="..."\`, \`text="..."\`, and any \`<font color="...">\` wrappers (unwrap the font tag, keep the inner content).

This is not optional and not aesthetic — it is a functional correctness requirement. The source HTML almost certainly contains \`color:rgb(54,55,55)\` or similar on every paragraph; your job is to strip them all.

## Concrete examples

INPUT:  <p style="margin:0 0 20px 0;color:rgb(54,55,55);line-height:26px;font-size:16px">Hello world</p>
OUTPUT: <p style="margin:0 0 20px 0;line-height:26px;font-size:16px">Hello world</p>

INPUT:  <span style="color:rgb(119,119,119)">small print</span>
OUTPUT: <span>small print</span>

INPUT:  <td bgcolor="#ffffff" style="background-color:#fff;padding:20px">cell</td>
OUTPUT: <td style="padding:20px">cell</td>

INPUT:  <font color="#333"><b>bold thing</b></font>
OUTPUT: <b>bold thing</b>

Do NOT introduce any new \`color\` or \`background\` values of your own anywhere.

---

Given this newsletter email HTML, extract:

1. **title**: The headline or subject of this issue
2. **author**: The writer's name if identifiable, or null
3. **publication_name**: The newsletter's name (e.g., "Stratechery", "Money Stuff")
4. **sender_email**: The newsletter's sending email address if visible in the email HTML (look for From headers, sender info, or footer text), or null
5. **issue_date**: The publication date (ISO 8601) if mentioned, or null
6. **content_html**: The COMPLETE article body as clean, semantic HTML, reproduced verbatim per the rule at the top:
   - Copy EVERY sentence and EVERY list item — this is transcription, not summarization
   - Keep: headings, paragraphs, blockquotes, lists, images (with src URLs), links, emphasis, strong
   - Keep: hero images, featured artwork, editorial illustrations, and any large decorative images that are part of the reading experience — these are content, not chrome
   - Remove: tiny tracking pixels (1x1 images), social media share buttons, "view in browser" links, unsubscribe links, email footer boilerplate, navigation menus
   - Remove: small UI icons, logos under 100px, spacer images, and advertisements
   - Preserve the author's structural choices (section breaks, pull quotes, asides)
   - When in doubt about whether an image is content or chrome, KEEP it
   - Apply the CRITICAL OUTPUT RULE above: strip \`color\`, \`background\`, \`background-color\` from every inline style; remove \`color=\`, \`bgcolor=\`, \`text=\` legacy attributes; unwrap \`<font color=...>\` tags.
7. **summary**: A single sentence summary of this issue
8. **images**: Array of ALL image URLs that appear in the content_html (not tracking pixels or tiny icons)

Return valid JSON only, no markdown fences.`;

const DESIGN_PROMPT = `Analyze this newsletter email's visual design and extract a design profile.

Look at the HTML/CSS and describe:
1. **color_primary**: The dominant brand/header color (hex)
2. **color_secondary**: The background or secondary color (hex)
3. **color_accent**: Any accent color used for links or callouts (hex)
4. **font_mood**: One of: "serif-formal", "serif-casual", "sans-formal", "sans-casual", "mono-technical", "mixed-editorial"
5. **layout_style**: One of: "longform-essay", "digest-links", "mixed-sections", "image-heavy"
6. **has_dividers**: Whether the newsletter uses horizontal rules or decorative dividers between sections
7. **has_pullquotes**: Whether the newsletter uses blockquote/pull-quote styling
8. **has_callout_boxes**: Whether there are highlighted aside/callout boxes

Return valid JSON only, no markdown fences.`;

function getClient(apiKey: string) {
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Strip non-content chrome from captured page HTML before sending to Gemini.
 *
 * WebView captures (document.documentElement.outerHTML) include inline <script>
 * bundles, <style> blocks, SVGs, etc. Pages that embed tweets inline Twitter's
 * entire minified webpack runtime (~hundreds of KB of high-entropy JS) — large
 * enough to make Gemini reject the request with `400 invalid argument`. None of
 * this is article content, so removing it fixes the 400, cuts token cost, and
 * gives the model a cleaner signal. Confirmed root cause via bisection on a
 * Twitter-embed-heavy page (Vlad's Blog).
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/<template\b[\s\S]*?<\/template>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

const MODEL = "gemini-3-flash-preview";
// Long-form newsletters can run 30k+ tokens of cleaned content. The 8192-token
// SDK default truncates them and breaks JSON parsing; raise to the model max.
const MAX_OUTPUT_TOKENS = 65535;
// Extraction is a transcription task, not a creative one. The SDK default
// temperature (1.0) gives the model latitude to "improve" the text — which on a
// digest newsletter manifests as silently abridging items. Pin it near zero so
// the model reproduces the source instead of editorializing.
const EXTRACTION_TEMPERATURE = 0;

function parseGeminiJson<T>(result: Awaited<ReturnType<ReturnType<GoogleGenerativeAI["getGenerativeModel"]>["generateContent"]>>, label: string): T {
  const text = result.response.text();
  const finishReason = result.response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
    throw new Error(
      `Gemini ${label} ended with finishReason=${finishReason} ` +
        `(output ${text.length} chars). Likely hit maxOutputTokens or a safety stop.`
    );
  }
  // The model occasionally ignores responseMimeType=application/json and wraps
  // its output in a ```json … ``` markdown fence despite the prompt forbidding it.
  // Strip a leading/trailing fence before parsing.
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    const tail = cleaned.slice(-200);
    throw new Error(
      `Gemini ${label} returned unparseable JSON (${cleaned.length} chars, finishReason=${finishReason ?? "unknown"}). Tail: ${tail}`
    );
  }

  // Despite responseMimeType=application/json and an object-shaped prompt, the
  // model non-deterministically wraps the result in a single-element array
  // (`[ { ... } ]`). That parses fine but leaves callers reading `.content_html`
  // off an Array, which is undefined — the root cause of silently empty content.
  // Unwrap a single-element array back to the object.
  if (Array.isArray(parsed) && parsed.length === 1) {
    parsed = parsed[0];
  }

  return parsed as T;
}

export async function extractContent(
  htmlBody: string,
  apiKey: string
): Promise<ExtractedContent> {
  const client = getClient(apiKey);
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: EXTRACTION_TEMPERATURE,
    },
  });

  const cleanHtml = sanitizeHtml(htmlBody);
  const userPart = `\n\nHere is the newsletter HTML:\n\n${cleanHtml}`;

  // Extraction is non-deterministic: a given call may return malformed JSON or
  // an empty content_html even when the same HTML extracts cleanly on the next
  // attempt. Retry a couple of times in-process before surfacing a failure to
  // the pipeline (which would otherwise wait out its 60s+ retry backoff).
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await model.generateContent([EXTRACTION_PROMPT, userPart]);
      const finishReason = result.response.candidates?.[0]?.finishReason;

      // The body genuinely exceeded one response. Don't fail (the old behavior
      // dropped the article) and don't ship the partial — switch to a chat-based
      // continuation that streams the body across multiple turns and stitches it.
      if (finishReason === "MAX_TOKENS") {
        return await extractLongArticle(client, cleanHtml);
      }

      const extracted = parseGeminiJson<ExtractedContent>(result, "extraction");
      if ((extracted.content_html ?? "").trim().length >= 50) {
        return extracted;
      }
      lastError = new Error(
        `extraction returned empty content_html on attempt ${attempt}`
      );
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("extraction failed after 3 attempts");
}

/**
 * Continuation path for articles whose body is too large to emit in a single
 * response. JSON mode is unusable here: a body that overflows maxOutputTokens
 * leaves a half-written, unparseable JSON string, and you can't "continue" a
 * JSON object cleanly. So we split the work:
 *
 *   1. Metadata (title/author/summary/etc.) — always small, one JSON call.
 *   2. Body — extracted as RAW HTML (no JSON wrapper) over a multi-turn chat.
 *      Each turn carries the full prior conversation ("thought circulation"),
 *      so the model resumes verbatim from where it stopped instead of
 *      restarting or re-summarizing. We loop until a turn ends with STOP.
 *
 * Stitching raw HTML fragments is safe (concatenation), whereas stitching JSON
 * fragments is not — which is the whole reason the body is pulled out of JSON.
 */
async function extractLongArticle(
  client: GoogleGenerativeAI,
  cleanHtml: string
): Promise<ExtractedContent> {
  const userPart = `\n\nHere is the newsletter HTML:\n\n${cleanHtml}`;

  // 1. Metadata only — small JSON, fits in one call.
  const jsonModel = client.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: EXTRACTION_TEMPERATURE,
    },
  });
  const META_PROMPT = `${EXTRACTION_PROMPT}

OVERRIDE FOR THIS CALL: set "content_html" to the empty string "". Return ONLY the metadata fields (title, author, publication_name, sender_email, issue_date, summary, images). Do not extract the body in this call.`;
  const metaResult = await jsonModel.generateContent([META_PROMPT, userPart]);
  const meta = parseGeminiJson<ExtractedContent>(metaResult, "long-article metadata");

  // 2. Body as raw HTML, continued across turns until it ends cleanly.
  const BODY_PROMPT = `You are an expert at extracting newsletter content from HTML emails.

Output ONLY the article body as clean semantic HTML — no JSON, no markdown fences, no commentary, just the HTML.

THIS IS VERBATIM EXTRACTION, NOT SUMMARIZATION. Copy every sentence and every list item exactly as written. Never summarize, shorten, paraphrase, or drop content.

Apply these output rules: strip \`color\`, \`background\`, \`background-color\` from every inline style; remove \`color=\`, \`bgcolor=\`, \`text=\` legacy attributes; unwrap \`<font color=...>\` tags. Remove only chrome: tracking pixels, share buttons, view-in-browser/unsubscribe links, footer/legal boilerplate, nav menus.

Here is the newsletter HTML:

${cleanHtml}`;

  // Separate model WITHOUT responseMimeType=application/json: we want raw HTML,
  // not JSON, so continuation turns can be concatenated. (A model created with
  // JSON mode keeps forcing JSON even when the per-request config omits it.)
  const textModel = client.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      temperature: EXTRACTION_TEMPERATURE,
    },
  });
  // Use a chat session so prior turns (including the partial body the model has
  // already produced) stay in context and it continues verbatim.
  const chat = textModel.startChat();

  let fullBody = "";
  let message = BODY_PROMPT;
  const MAX_TURNS = 8; // hard cap so a misbehaving model can't loop forever
  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const res = await chat.sendMessage(message);
    const chunk = res.response.text();
    const finish = res.response.candidates?.[0]?.finishReason;
    fullBody += chunk;

    if (finish === "STOP") break;
    if (finish !== "MAX_TOKENS") {
      throw new Error(
        `long-article body continuation ended with finishReason=${finish} on turn ${turn}`
      );
    }
    if (turn === MAX_TURNS) {
      throw new Error(
        `long-article body still truncated after ${MAX_TURNS} continuation turns (${fullBody.length} chars)`
      );
    }
    // Continue exactly where it left off. The chat history already contains the
    // partial body, so "continue" resumes mid-stream without repeating.
    message =
      "Continue the HTML extraction from exactly where you stopped. Do not " +
      "repeat anything you already output. Do not summarize the rest. Output " +
      "only the remaining HTML, verbatim.";
  }

  // Strip any stray markdown fence the model may have wrapped the HTML in.
  let body = fullBody.trim();
  if (body.startsWith("```")) {
    body = body.replace(/^```(?:html)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  if (body.length < 50) {
    throw new Error(
      `long-article extraction produced empty body (${body.length} chars)`
    );
  }

  return { ...meta, content_html: body };
}

export async function analyzeDesign(
  htmlBody: string,
  apiKey: string
): Promise<DesignProfile> {
  const client = getClient(apiKey);
  const model = client.getGenerativeModel({
    model: MODEL,
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  });

  // Strip only <script> + comments here (not <style>): design analysis relies
  // on style/color info, but the oversized inline JS bundles are what trip the
  // 400 and add no design signal.
  const cleanHtml = htmlBody
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const result = await model.generateContent([
    DESIGN_PROMPT,
    `\n\nHere is the newsletter HTML:\n\n${cleanHtml}`,
  ]);

  return parseGeminiJson<DesignProfile>(result, "design analysis");
}
