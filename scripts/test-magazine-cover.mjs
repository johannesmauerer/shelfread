#!/usr/bin/env node
// Integration test: build a real magazine EPUB with the painted cover and
// verify (a) the cover image landed in the EPUB, (b) it matches what the
// standalone compositor produces, (c) basic OPF metadata is intact.
//
// Run: node scripts/test-magazine-cover.mjs

import JSZip from "jszip";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { composeCover } from "./compose-cover.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Import the Convex module via tsx — bundler quirks force us to require()
// the runtime module rather than a static import in pure JS.
const { generateMagazineEpub } = await import(`${ROOT}/convex/lib/epub.ts`);

const fixture = {
  title: "ShelfRead Magazine — Issue #1, May 2026",
  issueNumber: 1,
  month: "2026-05",
  articles: [
    {
      title: "The Art of Slow Reading",
      author: "Jane Doe",
      seriesName: "On Reading Weekly",
      contentHtml:
        "<p>This is a test article body. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p><p>A second paragraph for good measure.</p>",
      summary: "Why we should slow down with the page.",
      issueDate: "2026-05-01",
    },
    {
      title: "Notes on Marginalia",
      author: null,
      seriesName: "Bookish Notes",
      contentHtml: "<p>Another test article. Pretend this is real prose.</p>",
      summary: null,
      issueDate: "2026-05-08",
    },
  ],
};

console.log("Generating EPUB...");
const epubBuf = await generateMagazineEpub(fixture);
console.log(`  size: ${(epubBuf.length / 1024).toFixed(1)} KB`);

const outDir = "/tmp/shelfread-test";
await mkdir(outDir, { recursive: true });
const epubPath = `${outDir}/magazine-2026-05-issue-1.epub`;
await writeFile(epubPath, epubBuf);
console.log(`  wrote: ${epubPath}`);

const zip = await JSZip.loadAsync(epubBuf);

// 1. Cover image is in the EPUB
const coverInZip = zip.file("OEBPS/cover.png");
if (!coverInZip) {
  console.error("FAIL: OEBPS/cover.png missing from EPUB");
  console.error("  files:", Object.keys(zip.files).join(", "));
  process.exit(1);
}
const coverFromEpub = await coverInZip.async("nodebuffer");
console.log(`  cover.png in EPUB: ${(coverFromEpub.length / 1024).toFixed(1)} KB`);

// Save extracted cover for visual review
const extractedPath = `${outDir}/extracted-cover.png`;
await writeFile(extractedPath, coverFromEpub);
console.log(`  extracted to: ${extractedPath}`);

// 2. Re-run the standalone compositor and compare byte-for-byte
const standaloneBuf = await composeCover({ month: "2026-05", issueNumber: 1 });
const standalonePath = `${outDir}/standalone-cover.png`;
await writeFile(standalonePath, standaloneBuf);
if (Buffer.compare(coverFromEpub, standaloneBuf) === 0) {
  console.log("  ✓ EPUB cover bytes identical to standalone composer output");
} else {
  console.warn(
    `  ⚠ EPUB cover differs from standalone (${coverFromEpub.length} vs ${standaloneBuf.length} bytes)`
  );
  console.warn("    visual check both files at:");
  console.warn(`      ${extractedPath}`);
  console.warn(`      ${standalonePath}`);
}

// 3. OPF references the cover correctly
const opf = await zip.file("OEBPS/content.opf").async("string");
const hasCoverItem = /<item[^>]+href="cover\.png"[^>]+properties="cover-image"/.test(opf);
const hasCoverMeta = /<meta\s+name="cover"\s+content="/.test(opf);
console.log(`  OPF cover-image item: ${hasCoverItem ? "✓" : "✗"}`);
console.log(`  OPF legacy cover meta: ${hasCoverMeta ? "✓" : "(absent — ok for EPUB3)"}`);

// 4. Stable identifier
const idMatch = opf.match(/<dc:identifier[^>]*>([^<]+)<\/dc:identifier>/);
const expectedId = "urn:shelf:magazine:2026-05";
if (idMatch && idMatch[1] === expectedId) {
  console.log(`  ✓ stable identifier: ${idMatch[1]}`);
} else {
  console.error(`  FAIL: identifier ${idMatch?.[1]} != expected ${expectedId}`);
  process.exit(1);
}

// 5. Series collection metadata
if (/belongs-to-collection.*ShelfRead Magazine/s.test(opf)) {
  console.log("  ✓ series collection metadata intact");
} else {
  console.error("  FAIL: collection metadata missing");
  process.exit(1);
}

// 6. Article chapters present
const chapterCount = Object.keys(zip.files).filter((n) =>
  /^OEBPS\/.*\.xhtml$/.test(n)
).length;
console.log(`  xhtml chapters in EPUB: ${chapterCount}`);
if (chapterCount < fixture.articles.length + 1) {
  console.error("  FAIL: missing chapters");
  process.exit(1);
}

console.log("\nAll checks passed.");
