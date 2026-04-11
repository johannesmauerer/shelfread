"use node";

import { EPub } from "epub-gen-memory";
import JSZip from "jszip";

interface EpubOptions {
  title: string;
  author: string | null;
  seriesName: string;
  contentHtml: string;
  summary: string | null;
  issueDate: string | null;
  css?: string;
}

const DEFAULT_CSS = `
body {
  font-family: Georgia, "Iowan Old Style", serif;
  line-height: 1.7;
  margin: 1em;
  color: #1a1a1a;
}
h1 { font-size: 1.8em; line-height: 1.2; margin-bottom: 0.3em; }
h2, h3 { color: #2c3e50; }
h2 { font-size: 1.4em; margin-top: 1.5em; }
h3 { font-size: 1.15em; margin-top: 1.2em; }
blockquote {
  border-left: 3px solid #e74c3c;
  margin-left: 0;
  padding-left: 1em;
  font-style: italic;
  color: #555;
}
hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
img { max-width: 100%; height: auto; }
a { color: #e74c3c; text-decoration: underline; }
p { margin: 0.8em 0; }
`;

function buildCoverHtml(seriesName: string, title: string, issueDate: string | null): string {
  const dateStr = issueDate
    ? new Date(issueDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return `
<div class="series-header">
  <div class="series-name">${escapeHtml(seriesName)}</div>
  ${dateStr ? `<div class="issue-date">${dateStr}</div>` : ""}
</div>
<h1>${escapeHtml(title)}</h1>
`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addFirstParagraphClass(html: string): string {
  return html.replace(/<p(?=[\s>])/, '<p class="first-paragraph"');
}

// Inject EPUB 3 belongs-to-collection metadata for series grouping
function injectSeriesMetadata(opfContent: string, seriesName: string): string {
  const seriesMetadata = `
        <meta property="belongs-to-collection" id="series-id">${escapeHtml(seriesName)}</meta>
        <meta refines="#series-id" property="collection-type">series</meta>
        <meta refines="#series-id" property="group-position">1</meta>`;

  return opfContent.replace("</metadata>", `${seriesMetadata}\n    </metadata>`);
}

// Remove TOC from the reading spine so it doesn't show as a page
function removeTocFromSpine(opfContent: string): string {
  return opfContent.replace(/<itemref idref="toc"\s*\/>/, "");
}

interface MagazineArticle {
  title: string;
  author: string | null;
  seriesName: string;
  contentHtml: string;
  summary: string | null;
  issueDate: string | null;
}

interface MagazineOptions {
  title: string; // "ShelfRead Magazine — Issue #1, Apr 2026"
  issueNumber: number;
  month: string; // "2026-04"
  articles: MagazineArticle[];
}

function buildMagazineCoverHtml(options: MagazineOptions): string {
  const date = new Date(options.month + "-01");
  const monthYear = date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
  });

  const articleList = options.articles
    .map(
      (a) =>
        `<li><strong>${escapeHtml(a.title)}</strong><br/>
         <span class="toc-meta">${escapeHtml(a.seriesName)}${a.author ? ` — ${escapeHtml(a.author)}` : ""}</span></li>`
    )
    .join("\n");

  return `
<div class="magazine-cover">
  <div class="magazine-brand">ShelfRead Magazine</div>
  <h1>Issue #${options.issueNumber}</h1>
  <div class="magazine-date">${monthYear}</div>
  <div class="magazine-count">${options.articles.length} article${options.articles.length === 1 ? "" : "s"}</div>
  <hr/>
  <div class="magazine-toc">
    <h2>In This Issue</h2>
    <ol>
      ${articleList}
    </ol>
  </div>
</div>
`;
}

function buildArticleChapterHtml(article: MagazineArticle): string {
  const dateStr = article.issueDate
    ? new Date(article.issueDate).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return `
<div class="article-header">
  <div class="article-series">${escapeHtml(article.seriesName)}</div>
  ${dateStr ? `<div class="article-date">${dateStr}</div>` : ""}
</div>
<h1>${escapeHtml(article.title)}</h1>
${article.author ? `<div class="article-author">By ${escapeHtml(article.author)}</div>` : ""}
${article.summary ? `<p class="article-summary"><em>${escapeHtml(article.summary)}</em></p>` : ""}
<hr/>
${article.contentHtml}
`;
}

const MAGAZINE_CSS = `
/* ShelfRead Magazine Stylesheet */

body {
  font-family: Georgia, "Iowan Old Style", serif;
  line-height: 1.7;
  margin: 1em;
  color: #1a1a1a;
}

/* Cover page */
.magazine-cover {
  text-align: center;
  padding-top: 2em;
}

.magazine-brand {
  font-size: 0.9em;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #c0392b;
  border-top: 4px solid #c0392b;
  border-bottom: 1px solid #c0392b;
  padding: 0.4em 0;
  margin-bottom: 1em;
}

.magazine-cover h1 {
  font-size: 2.4em;
  margin: 0.2em 0;
}

.magazine-date {
  font-size: 1.1em;
  color: #555;
}

.magazine-count {
  font-size: 0.85em;
  color: #888;
  margin-top: 0.3em;
}

.magazine-toc {
  text-align: left;
  margin-top: 2em;
}

.magazine-toc h2 {
  font-size: 1.2em;
  color: #c0392b;
}

.magazine-toc ol {
  padding-left: 1.2em;
}

.magazine-toc li {
  margin-bottom: 0.8em;
  line-height: 1.4;
}

.toc-meta {
  font-size: 0.8em;
  color: #888;
}

/* Article chapters */
.article-header {
  border-top: 3px solid #c0392b;
  padding-top: 0.5em;
  margin-bottom: 1em;
}

.article-series {
  font-size: 0.8em;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #c0392b;
}

.article-date {
  font-size: 0.75em;
  color: #888;
  margin-top: 0.2em;
}

.article-author {
  font-size: 0.9em;
  color: #555;
  margin-bottom: 1em;
}

.article-summary {
  color: #555;
  border-left: 3px solid #ddd;
  padding-left: 1em;
  margin: 1em 0;
}

h1 { font-size: 1.8em; line-height: 1.2; margin-bottom: 0.3em; }
h2, h3 { color: #2c3e50; }
h2 { font-size: 1.4em; margin-top: 1.5em; }
h3 { font-size: 1.15em; margin-top: 1.2em; }

blockquote {
  border-left: 3px solid #c0392b;
  margin-left: 0;
  padding-left: 1em;
  font-style: italic;
  color: #555;
}

hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
img { max-width: 100%; height: auto; }
a { color: #c0392b; text-decoration: underline; }
p { margin: 0.8em 0; }
`;

export async function generateMagazineEpub(options: MagazineOptions): Promise<Buffer> {
  const coverHtml = buildMagazineCoverHtml(options);

  const chapters = [
    {
      title: "Cover",
      content: coverHtml,
    },
    ...options.articles.map((article) => ({
      title: article.title,
      content: buildArticleChapterHtml(article),
    })),
  ];

  const epubInstance = new EPub(
    {
      title: options.title,
      author: "ShelfRead",
      publisher: "ShelfRead",
      description: `Monthly digest — ${options.articles.length} articles from your newsletters`,
      date: options.month + "-01",
      lang: "en",
      css: MAGAZINE_CSS,
      tocTitle: "Contents",
      prependChapterTitles: false,
      version: 3,
      fetchTimeout: 10000,
      retryTimes: 2,
      ignoreFailedDownloads: true,
    },
    chapters
  );

  await epubInstance.render();
  const rawBuffer = await epubInstance.genEpub();

  // Post-process: inject magazine collection metadata
  const zip = await JSZip.loadAsync(rawBuffer);
  const opfFile = zip.file("OEBPS/content.opf");
  if (opfFile) {
    let opfContent = await opfFile.async("string");
    opfContent = injectSeriesMetadata(opfContent, "ShelfRead Magazine");
    // Remove cover from spine so TOC is the natural entry
    opfContent = removeTocFromSpine(opfContent);
    zip.file("OEBPS/content.opf", opfContent);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
  });

  return buffer;
}

export async function generateEpub(options: EpubOptions): Promise<Buffer> {
  const css = options.css ?? DEFAULT_CSS;

  const coverHtml = buildCoverHtml(
    options.seriesName,
    options.title,
    options.issueDate
  );

  const contentWithDropCap = addFirstParagraphClass(options.contentHtml);

  const epubInstance = new EPub(
    {
      title: options.title,
      author: options.author || options.seriesName,
      publisher: options.seriesName,
      description: options.summary || undefined,
      date: options.issueDate || new Date().toISOString().split("T")[0],
      lang: "en",
      css,
      tocTitle: "Contents",
      prependChapterTitles: false,
      version: 3,
      fetchTimeout: 10000,
      retryTimes: 2,
      ignoreFailedDownloads: true,
    },
    [
      {
        title: options.title,
        content: coverHtml + contentWithDropCap,
      },
    ]
  );

  await epubInstance.render();
  const rawBuffer = await epubInstance.genEpub();

  // Post-process: inject series metadata into the OPF
  const zip = await JSZip.loadAsync(rawBuffer);
  const opfFile = zip.file("OEBPS/content.opf");
  if (opfFile) {
    let opfContent = await opfFile.async("string");
    opfContent = injectSeriesMetadata(opfContent, options.seriesName);
    opfContent = removeTocFromSpine(opfContent);
    zip.file("OEBPS/content.opf", opfContent);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
  });

  return buffer;
}
