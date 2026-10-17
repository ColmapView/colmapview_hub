import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { catalogRenderer } from '../scripts/catalog-renderer.mjs';
import { applyIndividualListings } from '../scripts/individual-listings.mjs';
import { applyDatasetLabels } from '../scripts/dataset-labels.mjs';

const render = await catalogRenderer();
const parent = { id: 'hf-owner-dataset-123456abcdef', sourceId: 'hf:owner/dataset', title: 'owner/dataset', provider: 'huggingface',
  sourceUrl: 'https://huggingface.co/datasets/owner/dataset', dataUrl: 'https://huggingface.co/datasets/owner/dataset/tree/abc/first/sparse/0',
  viewerUrl: 'https://colmapview.opsiclear.com/?url=sample', license: 'cc-by-4.0', access: 'public', status: 'audited_header_checked',
  statusLabel: 'Sample opened in viewer', formats: ['COLMAP'], description: 'A representative sample opened.', checkedAt: '2026-10-16', testOrFixture: false,
  facts: [{ label: 'Pinned revision', value: 'abc' }], audits: [{ sourceId: 'source-check', checkedAt: '2026-10-16', scope: 'source', facts: [] }],
  verification: { level: 'header_checked', delivery: 'browser_readable', checkedAt: '2026-10-16', summary: 'A representative sample opened.', scope: 'One sample.', viewerVersion: '0.16.14' } };
const source = { id: parent.id, sourceId: parent.sourceId, title: parent.title, label: 'NGS', provider: 'huggingface', license: parent.license,
  access: 'public', start: 0, count: 3, listingComplete: false };
const row = (number = 0, overrides = {}) => Object.assign([`data-${String(number).padStart(24, '0')}`, 0, 'colmap', `scene${number}/sparse/0`, 'COLMAP', null,
  { cameras: `scene${number}/sparse/0/cameras.bin`, images: `scene${number}/sparse/0/images.bin`, points3d: `scene${number}/sparse/0/points3D.bin` }, null], overrides);
const fixture = () => {
  const rows = [row(), row(1, { 7: { ...parent.verification, statusLabel: parent.statusLabel, viewerUrl: parent.viewerUrl } }), row(2),
    row(3, { 1: 1, 2: 'scene', 3: 'Public scene', 4: 'COLMAP' })];
  const other = { ...source, id: 'public-other-123456abcdef', sourceId: 'public:other', title: 'Other', label: 'Other', provider: 'public', start: 3, count: 1, listingComplete: true };
  const index = { schemaVersion: 1, generation: 'test-generation', total: 4, packSize: 2048, checkedAt: '2026-10-16', sources: [source, other],
    facets: { viewer: { available: { file: 'a'.repeat(16), count: 1 } } }, kinds: { 'COLMAP reconstruction': 3, 'Public scene': 1 },
    levels: { 'Files listed; load not checked': 3 }, delivery: { not_tested: 3 }, incompleteCollections: 1, scope: 'Listed models only.' };
  const shard = createHash('sha256').update('ngs').digest('hex').slice(0, 3);
  const assets = new Map([['index.json', index], ['packs/0.json', rows], [`tokens/${shard}.json`, { ngs: 'AAEB' }],
    [`facets/${'a'.repeat(16)}.json`, { postings: 'AQ==' }], [`ids/${rows[0][0].slice(5, 7)}.json`, { [rows[0][0]]: 0 }], [`sources/${parent.id}.json`, parent]]);
  const keys = [];
  const binding = { fetch: async request => {
    const url = new URL(request.url);
    assert.equal(url.origin, 'https://colmapview.opsiclear.com');
    assert.ok(url.pathname.startsWith('/hub/datasets/individual/'));
    const key = url.pathname.slice('/hub/datasets/individual/'.length);
    keys.push(key);
    return assets.has(key) ? Response.json(assets.get(key)) : new Response(null, { status: 404 });
  } };
  return { rows, index, binding, keys };
};

test('individual models inherit labels and licenses while sibling checks stay at collection scope', () => {
  const model = render.individualEntry(row(), source, parent);
  assert.equal(model.dataset.label, 'NGS');
  assert.equal(model.license, parent.license);
  assert.equal(model.viewerUrl, undefined);
  assert.equal(model.verification.level, 'file_set_only');
  assert.equal(model.statusLabel, 'Files listed; load not checked');
  assert.equal(model.audits[1].scope, 'collection');
  assert.ok(model.candidateViewerUrl.includes('scene0'));
  assert.equal(render.datasetPath(model), `/hub/datasets/entry/${model.id}`);
  assert.equal(render.catalogSummary(model).hasViewer, false);
});

test('compact cards load an eligible model directly while archives, access restrictions and failed samples keep source details', () => {
  const native = render.individualSummary(row(), source);
  assert.equal(native.openUrl, `/hub/datasets/open/${row()[0]}`);
  assert.equal(native.hasViewer, false);
  const html = render.catalogCard(native);
  assert.match(html, /class="dataset-open" href="\/hub\/datasets\/open\/data-/);
  assert.match(html, /Try · unchecked/);
  assert.match(html, /aria-controls="metadata-data-/);
  assert.match(html, /Full metadata/);
  for (const [record, origin] of [[row(0, { 5: 'archive.zip' }), source], [row(), { ...source, access: 'gated' }],
    [row(0, { 2: 'obj' }), source], [row(0, { 7: { ...parent.verification, level: 'conversion_needed' } }), source],
    [row(0, { 7: { ...parent.verification, delivery: 'access_denied', viewerUrl: parent.viewerUrl } }), source]]) {
    const summary = render.individualSummary(record, origin);
    assert.equal(summary.openUrl, undefined);
    assert.equal(render.individualEntry(record, origin, parent).candidateViewerUrl, undefined);
    assert.match(render.catalogCard(summary), /Source only/);
  }
  for (const openUrl of ['javascript:alert(1)', '//evil.example/', 'https://evil.example/?url=data', '/hub/datasets/open/../../secret']) {
    assert.equal(render.isCatalogSummary({ ...native, openUrl }), false);
    assert.ok(render.catalogCard({ ...native, openUrl }).includes(`href="${render.datasetPath(native)}"`));
  }
  const escaped = render.catalogCard({ ...native, title: '<img src=x onerror=alert(1)>', license: '<script>bad()</script>' });
  assert.doesNotMatch(escaped, /<img|<script>/);
});

test('failed decoders keep their individual evidence and never receive a retry labeled as supported', () => {
  const proof = { ...parent.verification, level: 'conversion_needed', summary: 'Decoder failed.', statusLabel: 'Conversion needed' };
  const model = render.individualEntry(row(0, { 2: 'spz', 3: 'new.spz', 6: null, 7: proof }), source, parent);
  assert.equal(model.viewerUrl, undefined);
  assert.equal(model.candidateViewerUrl, undefined);
  assert.match(render.catalogEntryPage(model), /Decoder failed/);
  assert.doesNotMatch(render.catalogEntryPage(model), /Try listed model/);
});

test('dataset labels and model names remain escaped in cards and detail pages', () => {
  const model = render.individualEntry(row(0, { 3: '<img src=x onerror=alert(1)>/sparse/0' }), { ...source, label: '<script>alert(1)</script>' }, parent);
  const html = render.catalogEntryPage(model);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.doesNotMatch(html, /<script>alert|<img src=x/);
  assert.equal(render.isCatalogSummary(render.catalogSummary(model)), true);
  assert.equal(render.isCatalogSummary({ ...render.catalogSummary(model), dataset: { id: '../private', label: 'bad', title: 'bad' } }), false);
});

test('posting lists decode large deltas and reject truncation and duplicate ordinals', () => {
  assert.deepEqual([...render.decodePostings('AAF/gH8=', 20000)], [0, 1, 128, 16384]);
  assert.deepEqual([...render.intersectPostings(Uint32Array.of(0, 1, 128, 16384), Uint32Array.of(1, 50, 16384))], [1, 16384]);
  assert.throws(() => render.decodePostings('gA==', 20000), /Truncated/);
  assert.throws(() => render.decodePostings('AAA=', 20000), /order/);
});

test('search intersects dataset names with exact sample evidence using fixed local asset keys', async () => {
  const { index, binding, keys } = fixture();
  const filters = render.individualFilters(new URLSearchParams('q=NGS&viewer=available'));
  const result = await render.searchIndividuals(binding, 'https://colmapview.opsiclear.com', index, filters);
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].id, row(1)[0]);
  assert.equal(result.entries[0].hasViewer, true);
  assert.equal(result.entries[0].dataset.label, 'NGS');
  assert.ok(keys.every(key => !key.startsWith('sources/')));
});

test('dataset and provider filters count individual records, not collection cards', async () => {
  const { index, binding } = fixture();
  const result = await render.searchIndividuals(binding, 'https://colmapview.opsiclear.com', index, new URLSearchParams(`dataset=${source.id}`));
  assert.equal(result.total, 3);
  assert.equal(result.entries.length, 3);
  const publicResult = await render.searchIndividuals(binding, 'https://colmapview.opsiclear.com', index, new URLSearchParams('provider=public'));
  assert.equal(publicResult.total, 1);
  const unknownFacet = await render.searchIndividuals(binding, 'https://colmapview.opsiclear.com', index, new URLSearchParams('viewer=constructor'));
  assert.equal(unknownFacet.total, 0);
  await assert.rejects(render.searchIndividuals(binding, 'https://colmapview.opsiclear.com', index, new URLSearchParams('page=2')), /does not exist/);
});

test('license category filtering inherits each source terms and composes with exact licenses, datasets and evidence', async () => {
  const { index, binding } = fixture();
  index.sources[1].license = 'cc-by-nc-4.0';
  for (const [category, expected] of [['commercial', 3], ['non-commercial', 1], ['not-specified', 0], ['constructor', 0]]) {
    const result = await render.searchIndividuals(binding, 'https://colmapview.opsiclear.com', index, new URLSearchParams(`licenseCategory=${category}`));
    assert.equal(result.total, expected);
    assert.ok(result.entries.every(entry => entry.licenseCategory === category));
  }
  const proof = await render.searchIndividuals(binding, 'https://colmapview.opsiclear.com', index,
    render.individualFilters(new URLSearchParams('licenseCategory=commercial&viewer=available&q=NGS')));
  assert.equal(proof.total, 1);
  assert.equal(proof.entries[0].hasViewer, true);
  const mismatch = await render.searchIndividuals(binding, 'https://colmapview.opsiclear.com', index,
    new URLSearchParams(`licenseCategory=non-commercial&dataset=${source.id}&license=cc-by-4.0`));
  assert.equal(mismatch.total, 0);
  index.sources[1].license = 'other';
  const unknown = await render.searchIndividuals(binding, 'https://colmapview.opsiclear.com', index, new URLSearchParams('licenseCategory=not-specified'));
  assert.equal(unknown.total, 1);
  assert.equal(unknown.entries[0].license, 'other');
  const filters = render.individualFilters(new URLSearchParams('licenseCategory=non-commercial&page=2'));
  assert.equal(filters.get('licenseCategory'), 'non-commercial');
  assert.equal(render.individualBrowseUrl(filters, 3), '/hub/datasets/?licenseCategory=non-commercial&page=3');
  const html = render.individualIndexPage({ origin: 'https://colmapview.opsiclear.com', path: '/hub', base: '/hub', local: false }, index, unknown, new URLSearchParams('licenseCategory=not-specified'));
  assert.match(html, /<option value="not-specified" selected>Not specified<\/option>/);
  assert.match(html, /<dt>License category<\/dt><dd>Not specified/);
});

test('a public dataset label groups scenes from separate source records while retaining each source identity', async () => {
  const { index, binding, rows } = fixture();
  index.sources[1].label = 'DTU';
  index.sources.push({ ...index.sources[1], id: 'public-second-123456abcdef', sourceId: 'public:second', title: 'Second scene', start: 4 });
  index.total = 5;
  rows.push(row(4, { 1: 2, 2: 'scene', 3: 'Second scene' }));
  const selected = await render.searchIndividuals(binding, 'https://colmapview.opsiclear.com', index, new URLSearchParams('dataset=public:DTU'));
  assert.equal(selected.total, 2);
  assert.notEqual(selected.entries[0].dataset.id, selected.entries[1].dataset.id);
  assert.equal(render.datasetFilterValue(selected.entries[0]), 'public:DTU');
  const selection = render.individualSelection(index.sources, 'public:DTU');
  assert.equal(selection.count, 2);
  assert.ok(selection.metadataUrl.includes('/collections?'));
  assert.equal(render.individualDatasetOptions(index.sources, '').filter(option => option.value === 'public:DTU').length, 1);
  assert.match(render.catalogCard(selected.entries[0]), /dataset=public%3ADTU/);
});

test('stable entry lookup returns only its source metadata and invalid IDs cannot become asset paths', async () => {
  const { index, binding, keys } = fixture();
  const model = await render.readIndividual(binding, 'https://colmapview.opsiclear.com', index, row()[0]);
  assert.equal(model.id, row()[0]);
  assert.equal(model.dataset.id, source.id);
  assert.equal(await render.readIndividual(binding, 'https://colmapview.opsiclear.com', index, '../../private'), null);
  await assert.rejects(render.individualAsset(binding, 'https://colmapview.opsiclear.com', '../../private'), /Invalid built catalog key/);
  assert.ok(keys.includes(`sources/${source.id}.json`));
});

test('search bounds work before reading metadata and pagination remains shareable without JavaScript', () => {
  assert.throws(() => render.individualFilters(new URLSearchParams('q=one two three four five six seven')), /six search/);
  assert.throws(() => render.individualFilters(new URLSearchParams('page=-1')), /Invalid dataset page/);
  const values = new URLSearchParams(`dataset=${source.id}&q=NGS`);
  assert.equal(new URL('https://example.org' + render.individualBrowseUrl(values, 2)).searchParams.get('page'), '2');
  assert.deepEqual(render.individualTokens('NGS/DTU_scan55 Gaussian-PLY café'), ['ngs', 'dtu', 'scan55', 'gaussian', 'ply', 'cafe']);
});

test('individual counts and dataset labels refresh metadata without transferring a sample check to siblings', () => {
  const snapshot = { entries: [structuredClone(parent)] };
  applyDatasetLabels(snapshot, { schemaVersion: 1, labels: { [parent.sourceId]: 'NGS' } });
  applyIndividualListings(snapshot, { schemaVersion: 1, checkedAt: '2026-10-16', individualEntries: 3,
    sources: [{ datasetId: parent.id, sourceId: parent.sourceId, revision: 'abc', count: 3, listingComplete: false, looseColmapCount: 2 }] });
  assert.equal(snapshot.entries[0].datasetLabel, 'NGS');
  assert.equal(snapshot.entries[0].viewerUrl, parent.viewerUrl);
  assert.equal(snapshot.entries[0].facts.find(fact => fact.label === 'Complete COLMAP models listed').value, '2');
  assert.equal(snapshot.individualSummary.entries, 3);
  assert.throws(() => applyIndividualListings(snapshot, { schemaVersion: 1, sources: [{ datasetId: parent.id, sourceId: parent.sourceId, revision: 'new' }] }), /revision changed/);
});

test('public archive models retain their source URL and extraction path without inventing an HF URL', () => {
  const publicParent = { ...parent, provider: 'public', sourceId: 'audit:public:neuman', sourceUrl: 'https://example.org/neuman',
    dataUrl: 'https://example.org/neuman.zip', facts: [], viewerUrl: undefined };
  const publicSource = { ...source, provider: 'public', sourceId: publicParent.sourceId, label: 'NeuMan' };
  const model = render.individualEntry(row(0, { 3: 'dataset/lab/sparse', 5: publicParent.dataUrl }), publicSource, publicParent);
  assert.equal(model.dataUrl, publicParent.dataUrl);
  assert.equal(model.sourceUrl, publicParent.sourceUrl);
  assert.equal(model.viewerUrl, undefined);
  assert.equal(model.dataset.label, 'NeuMan');
  assert.match(model.facts.find(fact => fact.label === 'Opening this model').value, /dataset\/lab\/sparse/);
  assert.ok(model.facts.every(fact => !fact.url || !fact.url.includes('huggingface.co')));
});
