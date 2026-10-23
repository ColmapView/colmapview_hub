import { readFile, readdir, mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { catalogRenderer } from './renderer.mjs';
import { publicUrl } from '../catalog/catalog-import.mjs';
import { publicationSnapshot } from '../catalog/catalog-publication.mjs';
import { applyIndividualListings } from '../catalog/individual-listings.mjs';
import { applyLicenseCategories } from '../catalog/license-categories.mjs';
import { runPython } from '../lib/python.mjs';

runPython(['-m', 'scripts.catalog.build_individual_catalog']);
runPython(['-m', 'scripts.catalog.component_audit']);

const json = async path => JSON.parse(await readFile(path, 'utf8'));
const sceneIndex = await json('public/hub/datasets/individual/index.json');
if (sceneIndex.unit !== 'named_scene' || Object.keys(sceneIndex.kinds).some(kind => !['COLMAP reconstruction', 'Cameras and poses', 'Camera dataset', 'Gaussian scene', 'Public scene'].includes(kind))) {
  throw new Error('Public browse entries must be named scene datasets. Refusing to publish a file inventory.');
}
const catalog = await json('data/catalog.json');
// Use the exact-scene projection for source metadata too. Historical collection
// samples must never restore an unqualified PLY or sibling-model launch.
const sourceEntries = await Promise.all(sceneIndex.sources.map(source => json(`public/hub/datasets/individual/sources/${source.id}.json`)));
const registry = await json('data/individual-datasets.json');
const currentSources = applyIndividualListings({ ...catalog, entries: sourceEntries }, registry);
const { snapshot, audit } = publicationSnapshot(currentSources, await json('data/dataset-audit.json'), registry, sceneIndex);
snapshot.photoAudit = { checkedAt: sceneIndex.checkedAt, scenes: sceneIndex.total, photos: sceneIndex.photos || {} };
if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.entries) || !snapshot.sources?.length || !snapshot.importSummary) throw new Error('Invalid catalog snapshot');
// Fail stale snapshots rather than publishing disagreeing collection/model labels.
const classified = await applyLicenseCategories(structuredClone(snapshot));
if (snapshot.entries.some((entry, index) => entry.licenseCategory !== classified.entries[index].licenseCategory)
  || snapshot.sources.find(source => source.kind === 'license-categories')?.sha256 !== classified.sources.at(-1).sha256) throw new Error('License categories are stale. Run npm run catalog:licenses.');
const ids = new Set();
for (const entry of snapshot.entries) {
  if (!/^[a-z0-9-]{1,80}-[a-f0-9]{12}$/.test(entry.id) || ids.has(entry.id) || !entry.title || !entry.license
    || !Array.isArray(entry.facts) || !Array.isArray(entry.audits) || !Array.isArray(entry.formats)) throw new Error('Invalid or duplicated catalog entry');
  ids.add(entry.id);
  for (const value of [entry.sourceUrl, entry.dataUrl, entry.viewerUrl]) if (value) publicUrl(value);
  if (entry.modelManifest) {
    publicUrl(entry.modelManifest.baseUrl);
    for (const value of [entry.modelManifest.imagesPath, ...Object.values(entry.modelManifest.files)]) if (value) publicUrl(new URL(value, entry.modelManifest.baseUrl).href);
  }
  for (const audit of entry.audits) if (audit.sourceUrl) publicUrl(audit.sourceUrl);
  for (const fact of [...entry.facts, ...entry.audits.flatMap(audit => audit.facts)]) if (fact.url) publicUrl(fact.url);
}
const { catalogAuditPage, catalogSummary, canOpenIndividual, individualSummary, decodePostings } = await catalogRenderer();
let checkedScenes = 0;
const observed = { kind: {}, status: {}, delivery: {}, photos: {}, data: {}, viewer: {} };
const add = (field, value, ordinal) => (observed[field][value] ??= []).push(ordinal);
const seen = new Set();
const sourceCounts = sceneIndex.sources.map(() => 0);
for (let pack = 0; pack < Math.ceil(sceneIndex.total / sceneIndex.packSize); pack++) {
  const rows = await json(`public/hub/datasets/individual/packs/${pack}.json`);
  for (const row of rows) {
    const source = sceneIndex.sources[row[1]];
    if (!source || !canOpenIndividual(row, source)) throw new Error(`Published scene fails the Hub loading contract: ${row[0]}`);
    const ordinal = checkedScenes++;
    if (!/^data-[a-f0-9]{24}$/.test(row[0]) || seen.has(row[0]) || ordinal !== source.start + sourceCounts[row[1]]++) throw new Error('Scene identities or source ranges disagree');
    seen.add(row[0]);
    const summary = individualSummary(row, source);
    for (const value of Object.values(summary.sceneStats)) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`Invalid scene statistic: ${row[0]}`);
    add('kind', summary.itemKind, ordinal);
    add('status', summary.statusLabel, ordinal);
    add('delivery', summary.delivery, ordinal);
    add('viewer', 'available', ordinal);
    add('photos', summary.photoStatus || 'not_checked', ordinal);
    if (['complete_export_checked', 'sample_checked', 'partial', 'video_frames'].includes(summary.photoStatus)) add('photos', 'available', ordinal);
    for (const component of Object.keys(summary.availableData || {})) add('data', component, ordinal);
  }
}
if (checkedScenes !== sceneIndex.total) throw new Error('Published scene packs disagree with the index total');
if (sourceCounts.some((count, i) => count !== sceneIndex.sources[i].count)) throw new Error('Published collection counts disagree');
for (const [field, values] of Object.entries(observed)) {
  const facets = sceneIndex.facets[field];
  if (Object.keys(values).sort().join('\0') !== Object.keys(facets || {}).sort().join('\0')) throw new Error(`Catalog ${field} facets disagree with cards`);
  for (const [value, ordinals] of Object.entries(values)) {
    const facet = facets[value];
    const posting = await json(`public/hub/datasets/individual/facets/${facet.file}.json`);
    if (facet.count !== ordinals.length || [...decodePostings(posting.postings, sceneIndex.total)].join() !== ordinals.join()) throw new Error(`Catalog ${field} facet disagrees with cards: ${value}`);
  }
  const totals = ({ kind: 'kinds', status: 'levels', delivery: 'delivery', photos: 'photos', data: 'contents' })[field];
  if (totals) {
    const counts = Object.fromEntries(Object.entries(values).filter(([value]) => field !== 'photos' || value !== 'available').map(([value, ordinals]) => [value, ordinals.length]));
    if (JSON.stringify(Object.entries(counts).sort()) !== JSON.stringify(Object.entries(sceneIndex[totals]).sort())) throw new Error(`Catalog ${totals} totals disagree with cards`);
  }
}
let checkedVariants = 0;
for (const name of await readdir('public/hub/datasets/individual/variants')) {
  if (!/^[a-f0-9]{2}\.json$/.test(name)) throw new Error('Unexpected retained variant asset');
  const variants = await json(`public/hub/datasets/individual/variants/${name}`);
  for (const [id, row] of Object.entries(variants)) {
    if (id !== row[0] || !/^data-[a-f0-9]{24}$/.test(id) || id.slice(5, 7) + '.json' !== name || seen.has(id)
      || !sceneIndex.sources[row[1]] || !canOpenIndividual(row, sceneIndex.sources[row[1]])) throw new Error(`Invalid retained scene variant: ${id}`);
    seen.add(id);
    checkedVariants++;
  }
}
if (checkedVariants !== sceneIndex.groupedVariants) throw new Error('Retained variant assets disagree with the index');
console.log(`Validated all ${checkedScenes.toLocaleString('en-US')} scene launches against the Hub loading contract.`);
const output = resolve('public/hub/datasets');
await mkdir(output, { recursive: true });
// Only generated files immediately inside this fixed directory are cleaned, never source data or child directories.
for (const file of await readdir(output, { withFileTypes: true })) {
  if (file.isFile() && /^(?:index\.html|collections\.html|audit\.html|dataset-audit\.json|(?:collection-)?page-\d+\.html|[a-z0-9-]+-[a-f0-9]{12}(?:\.html|\.manifest\.json)|catalog(?:-index)?\.json)$/.test(file.name)) await unlink(resolve(output, file.name));
}
for (const entry of snapshot.entries) {
  await writeFile(resolve(output, 'individual/sources', `${entry.id}.json`), JSON.stringify(entry));
  if (entry.modelManifest) await writeFile(resolve(output, `${entry.id}.manifest.json`), JSON.stringify(entry.modelManifest));
}
await writeFile(resolve(output, 'catalog-index.json'), JSON.stringify(snapshot.entries.map(catalogSummary)));
await writeFile(resolve(output, 'catalog.json'), JSON.stringify(snapshot));
if (snapshot.auditSummary) {
  await writeFile(resolve(output, 'audit.html'), catalogAuditPage(snapshot));
  await writeFile(resolve(output, 'dataset-audit.json'), JSON.stringify(audit));
}
console.log(`Built metadata for ${snapshot.entries.length} source collections and the catalog audit page; legacy HTML is removed.`);
