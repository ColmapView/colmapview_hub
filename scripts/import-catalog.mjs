import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { applyCatalogReviews, buildCatalog, parseCsv, sha256 } from './catalog-import.mjs';
import { applyDatasetAudit } from './dataset-audit-import.mjs';

const { values } = parseArgs({ options: { 'viewer-root': { type: 'string' }, out: { type: 'string', default: 'data/catalog.json' }, help: { type: 'boolean' } } });
if (values.help || !values['viewer-root']) {
  console.log('Usage: npm run catalog:import -- --viewer-root PATH [--out data/catalog.json]');
  process.exit(values.help ? 0 : 1);
}
const inputs = [
  ['hf', '.tmp/huggingface-scan-2026-10-12/all-candidates.csv', '2026-10-13'],
  ['public', '.tmp/public-colmap-expansion-2026-10-13/all-cors-safe-datasets.csv', '2026-10-14'],
  ['audit', '.tmp/dataset-loading-improvements-2026-10-15/dataset-source-notes.csv', '2026-10-15'],
];
const loaded = await Promise.all(inputs.map(async ([kind, name, checkedAt]) => {
  const bytes = await readFile(resolve(values['viewer-root'], name));
  const rows = parseCsv(bytes.toString('utf8'));
  return { kind, name: name.split('/').at(-1), checkedAt, sha256: sha256(bytes), rows };
}));
const snapshot = buildCatalog({ hfRows: loaded[0].rows, publicRows: loaded[1].rows, auditRows: loaded[2].rows,
  sources: loaded.map(({ rows, ...source }) => ({ ...source, rowCount: rows.length })) });
try {
  const auditBytes = await readFile(new URL('../data/dataset-audit.json', import.meta.url));
  const audit = JSON.parse(auditBytes.toString('utf8'));
  applyDatasetAudit(snapshot, audit, loaded[0].rows);
  snapshot.sources.push({ kind: 'audit-refresh', name: 'dataset-audit.json', checkedAt: audit.checkedAt.slice(0, 10),
    sha256: sha256(auditBytes), rowCount: audit.results.length });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const reviewBytes = await readFile(new URL('../data/catalog-reviews.json', import.meta.url));
const reviews = JSON.parse(reviewBytes.toString('utf8'));
if (reviews.schemaVersion !== 1 || !Array.isArray(reviews.entries)) throw new Error('Invalid catalog review schema');
applyCatalogReviews(snapshot, reviews.entries);
snapshot.sources.push({ kind: 'review', name: 'catalog-reviews.json',
  checkedAt: reviews.entries.map(review => review.checkedAt).sort().at(-1) || '2026-10-16',
  sha256: sha256(reviewBytes), rowCount: reviews.entries.length });
const output = resolve(values.out);
await mkdir(dirname(output), { recursive: true });
await writeFile(`${output}.tmp`, `${JSON.stringify(snapshot, null, 2)}\n`);
await rename(`${output}.tmp`, output);
console.log(JSON.stringify({ ...snapshot.importSummary, entries: snapshot.entries.length, output }, null, 2));
