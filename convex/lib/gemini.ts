"use node";

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ExtractedContent, DesignProfile } from "./types";

export type { ExtractedContent, DesignProfile };

const EXTRACTION_PROMPT = `You are an expert at extracting newsletter content from HTML emails.

# CRITICAL OUTPUT RULE — read this first, apply throughout

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
6. **content_html**: The article body as clean, semantic HTML:
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

const MODEL = "gemini-3-flash-preview";
// Long-form newsletters can run 30k+ tokens of cleaned content. The 8192-token
// SDK default truncates them and breaks JSON parsing; raise to the model max.
const MAX_OUTPUT_TOKENS = 65535;

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
    },
  });

  // Extraction is non-deterministic: a given call may return malformed JSON or
  // an empty content_html even when the same HTML extracts cleanly on the next
  // attempt. Retry a couple of times in-process before surfacing a failure to
  // the pipeline (which would otherwise wait out its 60s+ retry backoff).
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await model.generateContent([
        EXTRACTION_PROMPT,
        `\n\nHere is the newsletter HTML:\n\n${htmlBody}`,
      ]);
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

  const result = await model.generateContent([
    DESIGN_PROMPT,
    `\n\nHere is the newsletter HTML:\n\n${htmlBody}`,
  ]);

  return parseGeminiJson<DesignProfile>(result, "design analysis");
}
