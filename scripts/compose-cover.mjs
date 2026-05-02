#!/usr/bin/env node
// Compose a Shelfread magazine cover by overlaying masthead + issue badge
// onto the seasonal base art for a given month.
//
// Text is rendered to SVG <path> data via opentype.js using a bundled
// Playfair Display TTF so output is identical regardless of system fonts.
//
// Usage:
//   node scripts/compose-cover.mjs --month 2026-05 --issue 1 --out /tmp/may-issue-1.png
//
// Programmatic:
//   import { composeCover } from "./scripts/compose-cover.mjs";
//   const buf = await composeCover({ month: "2026-05", issueNumber: 1 });

import sharp from "sharp";
import opentype from "opentype.js";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COVERS_DIR = resolve(__dirname, "..", "assets", "covers");
const FONT_PATH = resolve(__dirname, "..", "assets", "fonts", "PlayfairDisplay-Bold.ttf");

const MONTH_NAMES = {
  "01": "january", "02": "february", "03": "march", "04": "april",
  "05": "may", "06": "june", "07": "july", "08": "august",
  "09": "september", "10": "october", "11": "november", "12": "december",
};

let cachedFont = null;
async function loadFont() {
  if (cachedFont) return cachedFont;
  const buf = await readFile(FONT_PATH);
  cachedFont = opentype.parse(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
  return cachedFont;
}

function baseCoverPath(month) {
  const [year, mm] = month.split("-");
  const name = MONTH_NAMES[mm];
  if (!name) throw new Error(`Invalid month: ${month}`);
  return join(COVERS_DIR, `${year}-${mm}-${name}.png`);
}

// Render text to an SVG path, centered horizontally on cx with the visual
// midline of the glyphs at cy (baseline-correct vertical centering).
function textToPath(font, text, { cx, cy, fontSize, fill }) {
  const path = font.getPath(text, 0, 0, fontSize);
  const bbox = path.getBoundingBox();
  const width = bbox.x2 - bbox.x1;
  const height = bbox.y2 - bbox.y1;
  // opentype's path is positioned with baseline at y=0; bbox.y1 is negative for ascenders.
  const x = cx - width / 2 - bbox.x1;
  const y = cy - height / 2 - bbox.y1;
  const d = font.getPath(text, x, y, fontSize).toPathData(2);
  return `<path d="${d}" fill="${fill}" />`;
}

// Same but anchored at a left x coordinate.
function textToPathLeft(font, text, { x, cy, fontSize, fill }) {
  const measure = font.getPath(text, 0, 0, fontSize);
  const bbox = measure.getBoundingBox();
  const height = bbox.y2 - bbox.y1;
  const ax = x - bbox.x1;
  const ay = cy - height / 2 - bbox.y1;
  const d = font.getPath(text, ax, ay, fontSize).toPathData(2);
  return `<path d="${d}" fill="${fill}" />`;
}

function buildOverlaySvg({ width, height, issueNumber, font }) {
  const navy = "#1a2540";
  const cream = "#f5efe1";

  // Masthead in the reserved top ~15% band.
  const mastheadCy = Math.round(height * 0.075);
  const mastheadFontSize = Math.round(width * 0.115);
  const masthead = textToPath(font, "Shelfread", {
    cx: width / 2,
    cy: mastheadCy,
    fontSize: mastheadFontSize,
    fill: navy,
  });

  // Issue badge — solo "№ N" centered in the reserved bottom-right circle.
  const badgeR = Math.round(width * 0.085);
  const badgeCx = width - Math.round(width * 0.13);
  const badgeCy = height - Math.round(height * 0.085);
  const badgeText = `№${issueNumber}`;
  // Scale font size based on number of characters so 3-digit issues fit.
  const charCount = badgeText.length;
  const badgeFontSize = Math.round(badgeR * (charCount <= 3 ? 0.95 : charCount === 4 ? 0.78 : 0.65));
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

export async function composeCover({ month, issueNumber }) {
  const [basePath, font] = await Promise.all([
    Promise.resolve(baseCoverPath(month)),
    loadFont(),
  ]);
  const baseBuf = await readFile(basePath);
  const baseImg = sharp(baseBuf);
  const meta = await baseImg.metadata();
  const svg = buildOverlaySvg({
    width: meta.width,
    height: meta.height,
    issueNumber,
    font,
  });
  return baseImg
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

async function main() {
  const { values } = parseArgs({
    options: {
      month: { type: "string" },
      issue: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.month || !values.issue || !values.out) {
    console.error("Usage: node scripts/compose-cover.mjs --month YYYY-MM --issue N --out path.png");
    process.exit(1);
  }
  const buf = await composeCover({
    month: values.month,
    issueNumber: parseInt(values.issue, 10),
  });
  await writeFile(values.out, buf);
  console.log(`WROTE: ${values.out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
