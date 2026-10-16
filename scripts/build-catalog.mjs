import { readFile, readdir, mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { catalogRenderer } from './catalog-renderer.mjs';
import { publicUrl } from './catalog-import.mjs';

const snapshot = JSON.parse(await readFile('data/catalog.json', 'utf8'));
if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.entries) || !snapshot.sources?.length || !snapshot.importSummary) throw new Error('Invalid catalog snapshot');
const ids = new Set();
for (const entry of snapshot.entries) {
  if (!/^[a-z0-9-]{1,80}-[a-f0-9]{12}$/.test(entry.id) || ids.has(entry.id) || !entry.title || !entry.license
    || !Array.isArray(entry.facts) || !Array.isArray(entry.audits) || !Array.isArray(entry.formats)) throw new Error('Invalid or duplicated catalog entry');
  ids.add(entry.id);
  for (const value of [entry.sourceUrl, entry.dataUrl, entry.viewerUrl]) if (value) publicUrl(value);
  for (const audit of entry.audits) if (audit.sourceUrl) publicUrl(audit.sourceUrl);
  for (const fact of [...entry.facts, ...entry.audits.flatMap(audit => audit.facts)]) if (fact.url) publicUrl(fact.url);
}
const { catalogIndexPage, catalogEntryPage, catalogSummary, CATALOG_PAGE_SIZE } = await catalogRenderer();
const output = resolve('public/hub/datasets');
await mkdir(output, { recursive: true });
// Only generated files immediately inside this fixed directory are cleaned, never source data or child directories.
for (const file of await readdir(output, { withFileTypes: true })) {
  if (file.isFile() && /^(?:index\.html|page-\d+\.html|[a-z0-9-]+-[a-f0-9]{12}\.html|catalog(?:-index)?\.json)$/.test(file.name)) await unlink(resolve(output, file.name));
}
const pages = Math.max(1, Math.ceil(snapshot.entries.length / CATALOG_PAGE_SIZE));
for (let page = 1; page <= pages; page++) await writeFile(resolve(output, page === 1 ? 'index.html' : `page-${page}.html`), catalogIndexPage(snapshot, page));
for (const entry of snapshot.entries) await writeFile(resolve(output, `${entry.id}.html`), catalogEntryPage(entry));
await writeFile(resolve(output, 'catalog-index.json'), JSON.stringify(snapshot.entries.map(catalogSummary)));
await writeFile(resolve(output, 'catalog.json'), JSON.stringify(snapshot));
console.log(`Built ${snapshot.entries.length} dataset pages and ${pages} browse pages without images.`);
