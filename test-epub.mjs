import { EPub } from 'epub-gen-memory';
import JSZip from 'jszip';

const epub = new EPub({
  title: 'ShelfRead Magazine — Issue #1, Apr 2026',
  author: 'ShelfRead',
  publisher: 'ShelfRead',
  date: '2026-04-01',
  lang: 'en',
  version: 3,
}, [{ title: 'Test', content: '<p>test</p>' }]);

await epub.render();
const buf = await epub.genEpub();
const zip = await JSZip.loadAsync(buf);
const opf = await zip.file('OEBPS/content.opf').async('string');

// Show the identifier and modified lines
const idMatch = opf.match(/<dc:identifier[^>]*>[^<]+<\/dc:identifier>/);
console.log('IDENTIFIER:', idMatch?.[0]);

const modMatch = opf.match(/<meta property="dcterms:modified">[^<]+<\/meta>/);
console.log('MODIFIED:', modMatch?.[0]);

const titleMatch = opf.match(/<dc:title>[^<]+<\/dc:title>/);
console.log('TITLE:', titleMatch?.[0]);

// Test our replacement
const stableId = 'urn:shelf:magazine:2026-04';
const replaced = opf.replace(
  /<dc:identifier id="BookId">[^<]+<\/dc:identifier>/,
  `<dc:identifier id="BookId">${stableId}</dc:identifier>`
);
const idMatch2 = replaced.match(/<dc:identifier[^>]*>[^<]+<\/dc:identifier>/);
console.log('AFTER REPLACE:', idMatch2?.[0]);
