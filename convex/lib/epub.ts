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

  // Insert before </metadata>
  return opfContent.replace("</metadata>", `${seriesMetadata}\n    </metadata>`);
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
    const opfContent = await opfFile.async("string");
    const updatedOpf = injectSeriesMetadata(opfContent, options.seriesName);
    zip.file("OEBPS/content.opf", updatedOpf);
  }

  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    mimeType: "application/epub+zip",
    compression: "DEFLATE",
  });

  return buffer;
}
