"use node";

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ExtractedContent, DesignProfile } from "./types";

export type { ExtractedContent, DesignProfile };

const EXTRACTION_PROMPT = `You are an expert at extracting newsletter content from HTML emails.

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

const MODEL = "gemini-3-flash";
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
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const tail = text.slice(-200);
    throw new Error(
      `Gemini ${label} returned unparseable JSON (${text.length} chars, finishReason=${finishReason ?? "unknown"}). Tail: ${tail}`
    );
  }
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

  const result = await model.generateContent([
    EXTRACTION_PROMPT,
    `\n\nHere is the newsletter HTML:\n\n${htmlBody}`,
  ]);

  return parseGeminiJson<ExtractedContent>(result, "extraction");
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
