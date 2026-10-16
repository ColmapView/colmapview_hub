import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { buildCatalog, parseCsv, publicUrl } from '../scripts/catalog-import.mjs';
import { catalogRenderer } from '../scripts/catalog-renderer.mjs';

const render = await catalogRenderer();
const sources = [{ kind: 'hf', name: 'test.csv', checkedAt: '2026-10-13', sha256: '0'.repeat(64), rowCount: 1 }];
const hf = (overrides = {}) => ({ id: 'owner/dataset', status: 'direct_colmap', asset_kinds: 'COLMAP', gated: 'False',
  license: 'cc-by-4.0', dataset_url: 'https://huggingface.co/datasets/owner/dataset', load_url: 'https://huggingface.co/datasets/owner/dataset/tree/abc/scene',
  viewer_url: 'https://colmapview.github.io/?url=https%3A%2F%2Fhuggingface.co%2Fdatasets%2Fowner%2Fdataset%2Ftree%2Fabc%2Fscene',
  evidence: 'Model filenames identified; not a complete render check.', revision: 'abc', model_count: '2', test_or_fixture: 'False', ...overrides });
const publicRow = (overrides = {}) => ({ collection: 'Example collection', scene: 'scene1', variant: 'original',
  source_url: 'https://zenodo.org/records/123', data_url: 'https://zenodo.org/api/records/123/files/scene1.zip/content',
  export_route: 'native COLMAP + RGB', data_license: 'not independently confirmed', ...overrides });
const audit = (overrides = {}) => ({ source_id: 'hf:owner/dataset', dataset: 'owner/dataset', source_kind: 'hf-files',
  url: 'https://huggingface.co/datasets/owner/dataset/resolve/abc/', complete_model_records: '2', representative_pairs_checked: '1',
  all_sampled_paths_match: '0', current_sampled_layouts_unresolved: '1', qualification_limit: 'Sampled paths do not certify every scene.', ...overrides });
const catalog = (overrides = {}) => buildCatalog({ hfRows: [hf()], publicRows: [], auditRows: [], sources, ...overrides });

test('CSV preserves quoted newlines, commas, escaped quotes, blank values and UTF-8 BOM', () => {
  assert.deepEqual(parseCsv('\uFEFFname,note,empty\r\n"one,two","line 1\nline ""2""",\r\n'), [
    { name: 'one,two', note: 'line 1\nline "2"', empty: '' },
  ]);
  assert.throws(() => parseCsv('a,a\n1,2'), /columns/);
  assert.throws(() => parseCsv('a,b\n"open,2'), /Unterminated/);
  assert.throws(() => parseCsv('a,b\n1,2,3'), /expected 2/);
  assert.throws(() => parseCsv('a\n"one"suffix'), /quoting/);
});

test('imports relevant records without promoting rejected matches or conversion candidates to playable datasets', () => {
  const snapshot = catalog({ hfRows: [hf(), hf({ id: 'other/converted', status: 'camera_metadata_needs_conversion' }),
    hf({ id: 'other/rejected', status: 'no_supported_3d_evidence' }), hf({ id: 'other/error', status: 'inspection_error' })] });
  assert.equal(snapshot.entries.length, 2);
  const entry = snapshot.entries.find(entry => entry.sourceId === 'hf:owner/dataset');
  assert.equal(entry.license, 'cc-by-4.0');
  assert.equal(entry.access, 'public');
  assert.equal(new URL(entry.viewerUrl).origin, 'https://colmapview.opsiclear.com');
  assert.equal(new URL(entry.viewerUrl).searchParams.get('url'), hf().load_url);
  assert.equal(snapshot.entries.find(entry => entry.sourceId === 'hf:other/converted').viewerUrl, undefined);
});

test('preserves gated access, unknown licenses and sampled failures without claiming full qualification', () => {
  const entry = catalog({ hfRows: [hf({ gated: 'auto', license: '', evidence: 'File listing only' })], auditRows: [audit()] }).entries[0];
  assert.equal(entry.access, 'gated');
  assert.equal(entry.license, 'Not specified');
  assert.equal(entry.audits[0].facts.find(fact => fact.label === 'Sampled layouts still unresolved').value, '1');
  assert.equal(entry.audits[0].facts.find(fact => fact.label === 'Scope of this check').value, audit().qualification_limit);
});

test('keeps entry IDs stable when scan counts, license, evidence or source revision change', () => {
  const first = catalog().entries[0];
  const second = catalog({ hfRows: [hf({ model_count: '3', license: 'apache-2.0', evidence: 'A later sample', revision: 'def' })] }).entries[0];
  assert.equal(first.id, second.id);
  const oldAudit = audit({ source_id: 'public:stable', source_kind: 'public-archive', url: 'https://example.org/old.zip' });
  const oldSource = catalog({ hfRows: [], auditRows: [oldAudit] }).entries[0];
  const newSource = catalog({ hfRows: [], auditRows: [{ ...oldAudit, url: 'https://example.org/new.zip' }] }).entries[0];
  assert.notEqual(oldSource.title, newSource.title);
  assert.equal(oldSource.id, newSource.id);
  assert.throws(() => catalog({ hfRows: [hf(), hf()] }), /Duplicate/);
});

test('retains distinct public variants and labels same-collection audit scope explicitly', () => {
  const snapshot = catalog({ hfRows: [], publicRows: [publicRow(), publicRow({ variant: 'resized' })],
    auditRows: [audit({ source_id: 'public:other', source_kind: 'public-archive', dataset: 'other', url: 'https://zenodo.org/api/records/123/files/scene2.zip/content' })] });
  assert.equal(snapshot.entries.length, 2);
  assert.notEqual(snapshot.entries[0].id, snapshot.entries[1].id);
  assert.equal(snapshot.entries[0].audits[0].scope, 'collection');
  assert.match(render.catalogEntryPage(snapshot.entries[0]), /these checks do not certify this entry’s scene/);
});

test('recognizes GCS routes for the same object and retains otherwise unlisted audit sources', () => {
  const snapshot = catalog({ hfRows: [], publicRows: [publicRow({ source_url: 'https://example.org/', data_url: 'https://storage.googleapis.com/bucket/scene.zip' })],
    auditRows: [audit({ source_id: 'public:gcs', source_kind: 'public-archive', dataset: 'scene', url: 'https://storage.googleapis.com/storage/v1/b/bucket/o/scene.zip?alt=media' }),
      audit({ source_id: 'public:other', source_kind: 'public-archive', dataset: 'other', url: 'https://example.org/other.zip' })] });
  assert.equal(snapshot.entries.length, 2);
  assert.equal(snapshot.importSummary.additionalAuditEntries, 1);
  assert.equal(snapshot.importSummary.linkedAuditRows, 2);
  assert.deepEqual(snapshot.importSummary.unlinkedAuditSourceIds, []);
  assert.equal(snapshot.entries.find(entry => entry.status === 'audit_only_source').license, 'Not specified');
});

test('refuses credentials and unsupported URL schemes, including nested viewer data URLs', () => {
  for (const value of ['javascript:alert(1)', 'file:///private/data', 'https://name:password@example.org/data',
    'https://example.org/?X-Amz-Signature=secret', 'https://example.org/#access_token=secret', 'http://localhost/data']) {
    assert.throws(() => publicUrl(value), /public HTTP/);
  }
  assert.throws(() => catalog({ hfRows: [hf({ viewer_url: 'https://colmapview.github.io/?url=https%3A%2F%2Fexample.org%2F%3Ftoken%3Dsecret' })] }), /credentials/);
});

test('renders text-only entry pages with escaped metadata, source links, license and audit information', () => {
  const entry = catalog({ hfRows: [hf({ id: 'owner/<script>', license: '"><img src=x onerror=alert(1)>', evidence: '<script>alert(1)</script>' })], auditRows: [] }).entries[0];
  const html = render.catalogEntryPage(entry);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /License \(source metadata\)/);
  assert.match(html, /Scan date/);
  assert.match(html, /href="https:\/\/huggingface.co\/datasets\/owner\/dataset"/);
  assert.doesNotMatch(html, /<img|<iframe|<canvas|og:image|summary_large_image|<script>alert/);
  assert.match(html, /twitter:card" content="summary"/);
});

test('filters by all query words, source, exact license and evidence level', () => {
  const entries = catalog({ hfRows: [hf(), hf({ id: 'other/splat', license: 'apache-2.0', asset_kinds: 'Gaussian splat', status: 'direct_gaussian_splat' })] }).entries.map(render.catalogSummary);
  const filters = { query: 'OWNER COLMAP', provider: 'huggingface', license: 'cc-by-4.0', status: 'Format identified' };
  assert.equal(render.filterCatalog(entries, filters).length, 1);
  assert.equal(render.filterCatalog(entries, { ...filters, provider: 'public' }).length, 0);
  assert.equal(render.filterCatalog(entries, { ...filters, query: 'absent' }).length, 0);
});

test('the committed snapshot preserves every supplied public row and every audit record with unique stable URLs', async () => {
  const snapshot = JSON.parse(await readFile('data/catalog.json', 'utf8'));
  assert.equal(snapshot.importSummary.hfCandidates, snapshot.sources.find(source => source.kind === 'hf').rowCount);
  assert.equal(snapshot.importSummary.hfEntries, snapshot.entries.filter(entry => entry.provider === 'huggingface').length);
  assert.equal(snapshot.importSummary.publicEntries, snapshot.sources.find(source => source.kind === 'public').rowCount);
  assert.equal(snapshot.importSummary.auditRows, snapshot.sources.find(source => source.kind === 'audit').rowCount);
  assert.equal(snapshot.importSummary.linkedAuditRows, snapshot.importSummary.auditRows);
  assert.deepEqual(snapshot.importSummary.unlinkedAuditSourceIds, []);
  assert.equal(snapshot.entries.length, snapshot.importSummary.hfEntries + snapshot.importSummary.publicEntries + snapshot.importSummary.additionalAuditEntries);
  assert.equal(new Set(snapshot.entries.map(entry => entry.id)).size, snapshot.entries.length);
  for (const entry of snapshot.entries) {
    assert(render.isCatalogSummary(render.catalogSummary(entry)), entry.id);
    assert(entry.license);
    assert(publicUrl(entry.sourceUrl));
    assert.doesNotMatch(render.catalogEntryPage(entry), /<(?:img|iframe|canvas)\b|og:image/);
  }
  assert(snapshot.sources.every(source => /^[a-f0-9]{64}$/.test(source.sha256)));
  const first = render.catalogIndexPage(snapshot);
  assert.match(first, /catalog-search/);
  assert.match(first, /\/hub\/assets\/catalog.js/);
  assert.match(first, /\/hub\/datasets\/page-2/);
  assert.doesNotMatch(first, /<img|og:image/);
  const headers = await readFile('public/_headers', 'utf8');
  assert.match(headers, /\/hub\/datasets\/\*[\s\S]*Cache-Control: public, max-age=300, no-transform/);
});
