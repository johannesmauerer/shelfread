// OPDS Atom/XML feed builder — no "use node" needed, pure string templates

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isoDate(ts?: number): string {
  return ts ? new Date(ts).toISOString() : new Date().toISOString();
}

interface CatalogEntry {
  title: string;
  id: string;
  href: string;
  type: string;
  content?: string;
  updated: string;
}

interface AcquisitionEntry {
  title: string;
  id: string;
  author?: string;
  updated: string;
  published?: string;
  summary?: string;
  downloadHref: string;
  seriesName?: string;
  sizeBytes?: number;
}

export function navigationFeed(opts: {
  id: string;
  title: string;
  selfHref: string;
  startHref: string;
  updated: string;
  entries: CatalogEntry[];
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${escapeXml(opts.id)}</id>
  <title>${escapeXml(opts.title)}</title>
  <updated>${opts.updated}</updated>
  <author><name>Shelf</name></author>
  <link rel="self" href="${escapeXml(opts.selfHref)}"
        type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="start" href="${escapeXml(opts.startHref)}"
        type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
${opts.entries
  .map(
    (e) => `  <entry>
    <title>${escapeXml(e.title)}</title>
    <id>${escapeXml(e.id)}</id>
    <link href="${escapeXml(e.href)}" type="${escapeXml(e.type)}"/>
    ${e.content ? `<content type="text">${escapeXml(e.content)}</content>` : ""}
    <updated>${e.updated}</updated>
  </entry>`
  )
  .join("\n")}
</feed>`;
}

export function acquisitionFeed(opts: {
  id: string;
  title: string;
  selfHref: string;
  startHref: string;
  updated: string;
  entries: AcquisitionEntry[];
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>${escapeXml(opts.id)}</id>
  <title>${escapeXml(opts.title)}</title>
  <updated>${opts.updated}</updated>
  <author><name>Shelf</name></author>
  <link rel="self" href="${escapeXml(opts.selfHref)}"
        type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <link rel="start" href="${escapeXml(opts.startHref)}"
        type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
${opts.entries
  .map(
    (e) => `  <entry>
    <title>${escapeXml(e.title)}</title>
    <id>${escapeXml(e.id)}</id>
    ${e.author ? `<author><name>${escapeXml(e.author)}</name></author>` : ""}
    <updated>${e.updated}</updated>
    ${e.published ? `<published>${e.published}</published>` : ""}
    ${e.summary ? `<summary>${escapeXml(e.summary)}</summary>` : ""}
    <link href="${escapeXml(e.downloadHref)}"
          type="application/epub+zip"
          rel="http://opds-spec.org/acquisition"/>
  </entry>`
  )
  .join("\n")}
</feed>`;
}
