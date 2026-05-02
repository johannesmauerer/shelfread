"use node";

// Compose a Shelfread magazine cover for a given month + issue number.
// Base art (per month) and the Playfair Display TTF live in the open-source
// repo on GitHub and are fetched on first use, then cached in module memory
// for the lifetime of the Convex container.
//
// Mirror of scripts/compose-cover.mjs; kept in sync intentionally.

import sharp from "sharp";
import opentype from "opentype.js";

const ASSET_BASE_URL =
  process.env.SHELFREAD_ASSET_BASE_URL ??
  "https://raw.githubusercontent.com/johannesmauerer/shelfread/main/assets";

const MONTH_NAMES: Record<string, string> = {
  "01": "january", "02": "february", "03": "march", "04": "april",
  "05": "may", "06": "june", "07": "july", "08": "august",
  "09": "september", "10": "october", "11": "november", "12": "december",
};

let cachedFont: opentype.Font | null = null;
const cachedCovers = new Map<string, Buffer>();

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Asset fetch failed: ${url} → ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function loadFont(): Promise<opentype.Font> {
  if (cachedFont) return cachedFont;
  const buf = await fetchBuffer(`${ASSET_BASE_URL}/fonts/PlayfairDisplay-Bold.ttf`);
  cachedFont = opentype.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
  return cachedFont;
}

async function loadBaseCover(month: string): Promise<Buffer> {
  const cached = cachedCovers.get(month);
  if (cached) return cached;
  const [, mm] = month.split("-");
  const name = MONTH_NAMES[mm];
  if (!name) throw new Error(`Invalid month: ${month}`);
  const url = `${ASSET_BASE_URL}/covers/${month}-${name}.png`;
  const buf = await fetchBuffer(url);
  cachedCovers.set(month, buf);
  return buf;
}

interface TextPlacement {
  cx: number;
  cy: number;
  fontSize: number;
  fill: string;
}

function textToPath(
  font: opentype.Font,
  text: string,
  { cx, cy, fontSize, fill }: TextPlacement
): string {
  const measure = font.getPath(text, 0, 0, fontSize);
  const bbox = measure.getBoundingBox();
  const width = bbox.x2 - bbox.x1;
  const height = bbox.y2 - bbox.y1;
  const x = cx - width / 2 - bbox.x1;
  const y = cy - height / 2 - bbox.y1;
  const d = font.getPath(text, x, y, fontSize).toPathData(2);
  return `<path d="${d}" fill="${fill}" />`;
}

function buildOverlaySvg(
  width: number,
  height: number,
  issueNumber: number,
  font: opentype.Font
): string {
  const navy = "#1a2540";
  const cream = "#f5efe1";

  const mastheadCy = Math.round(height * 0.075);
  const mastheadFontSize = Math.round(width * 0.115);
  const masthead = textToPath(font, "Shelfread", {
    cx: width / 2,
    cy: mastheadCy,
    fontSize: mastheadFontSize,
    fill: navy,
  });

  const badgeR = Math.round(width * 0.085);
  const badgeCx = width - Math.round(width * 0.13);
  const badgeCy = height - Math.round(height * 0.085);
  const badgeText = `№${issueNumber}`;
  const charCount = badgeText.length;
  const badgeFontSize = Math.round(
    badgeR * (charCount <= 3 ? 0.95 : charCount === 4 ? 0.78 : 0.65)
  );
  const stroke = Math.max(2, Math.round(badgeR * 0.05));
  const badgeBg = `<circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeR}" fill="${cream}" stroke="${navy}" stroke-width="${stroke}" />`;
  const badgeNum = textToPath(font, badgeText, {
    cx: badgeCx,
    cy: badgeCy,
    fontSize: badgeFontSize,
    fill: navy,
  });

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${masthead}
  ${badgeBg}
  ${badgeNum}
</svg>`;
}

export interface CoverOptions {
  month: string; // "2026-05"
  issueNumber: number;
}

export async function composeCover(opts: CoverOptions): Promise<Buffer> {
  const [font, baseBuf] = await Promise.all([
    loadFont(),
    loadBaseCover(opts.month),
  ]);
  const baseImg = sharp(baseBuf);
  const meta = await baseImg.metadata();
  if (!meta.width || !meta.height) {
    throw new Error("Base cover has no width/height metadata");
  }
  const svg = buildOverlaySvg(meta.width, meta.height, opts.issueNumber, font);
  return baseImg
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}
