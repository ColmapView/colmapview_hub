import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { applyCatalogReviews, buildCatalog, parseCsv, publicUrl } from '../scripts/catalog-import.mjs';
import { catalogRenderer } from '../scripts/catalog-renderer.mjs';
import { applyDatasetAudit, makeDatasetAudit, requiredProbeUrls } from '../scripts/dataset-audit-import.mjs';

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

test('reviewed false positives retain their URL and evidence without a viewer action, and require a revision recheck', () => {
  const snapshot = catalog();
  const id = snapshot.entries[0].id;
  const review = { sourceId: 'hf:owner/dataset', revision: 'abc', checkedAt: '2026-10-16',
    description: 'Image crops only; no camera calibration, poses or geometry.', formats: ['JPEG', 'JSON labels'],
    sourceUrl: 'https://huggingface.co/datasets/owner/dataset/resolve/abc/summary.json',
    facts: [{ label: 'Archive contents', value: 'All files inspected; JPEG crops and labels.json only.' }] };
  applyCatalogReviews(snapshot, [review]);
  const entry = snapshot.entries[0];
  assert.equal(entry.id, id);
  assert.equal(entry.status, 'unsupported_content');
  assert.equal(entry.viewerUrl, undefined);
  assert.match(render.catalogEntryPage(entry), /Not loadable in ColmapView/);
  assert.match(render.catalogEntryPage(entry), /JPEG crops and labels.json only/);
  assert.doesNotMatch(render.catalogEntryPage(entry), /Try in ColmapView/);
  assert.throws(() => applyCatalogReviews(catalog({ hfRows: [hf({ revision: 'def' })] }), [review]), /revision changed; recheck/);
  assert.throws(() => applyCatalogReviews(catalog(), [review, review]), /duplicate catalog review/);
  assert.throws(() => applyCatalogReviews(catalog(), [{ ...review, sourceUrl: 'https://example.org/?token=secret' }]), /credentials/);
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

test('format evidence alone cannot restore a viewer link; every required native file needs a browser read', () => {
  const paths = ['cameras.bin', 'images.bin', 'points3D.bin'];
  const probes = paths.map(path => ({ path, url: `https://example.org/${path}`, httpStatus: 206 }));
  const result = { sourceId: 'hf:owner/dataset', level: 'header_checked', revision: 'abc', checkedAt: '2026-10-16T00:00:00Z',
    formats: ['colmap'], probes, issues: [], delivery: 'server_readable', loadUrl: hf().load_url, license: ['cc-by-4.0'] };
  assert.equal(requiredProbeUrls(result).length, 3);
  const hfReport = { results: [result] }, publicReport = { results: [] };
  const browser = { origin: 'https://colmapview.opsiclear.com', results: probes.map(probe => ({ url: probe.url, delivery: 'browser_readable', checkedAt: result.checkedAt, prefix: { status: 206 } })) };
  const incomplete = makeDatasetAudit(hfReport, publicReport, { ...browser, results: browser.results.slice(0, 2) }, '0.16.14');
  assert.equal(applyDatasetAudit(catalog(), incomplete).entries[0].viewerUrl, undefined);
  const complete = makeDatasetAudit(hfReport, publicReport, browser, '0.16.14');
  const entry = applyDatasetAudit(catalog(), complete).entries[0];
  assert.equal(new URL(entry.viewerUrl).searchParams.get('url'), result.loadUrl);
  assert.equal(entry.verification.delivery, 'browser_readable');
  assert.match(render.catalogEntryPage(entry), /Complete scene parsing and rendering remain unverified/);
  const blocked = makeDatasetAudit(hfReport, publicReport, { ...browser, results: browser.results.map((check, index) => index === 2 ? { ...check, delivery: 'browser_request_failed' } : check) }, '0.16.14');
  assert.equal(applyDatasetAudit(catalog(), blocked).entries[0].viewerUrl, undefined);
});

test('a recovered rejected source gets a stable entry and current format evidence without reviving unrelated matches', () => {
  const rows = [hf({ status: 'no_supported_3d_evidence' }), hf({ id: 'other/unrelated', status: 'no_supported_3d_evidence' })];
  const result = { sourceId: 'hf:owner/dataset', level: 'header_checked', revision: 'def', checkedAt: '2026-10-16T00:00:00Z',
    formats: ['point_cloud_ply'], probes: [{ url: 'https://example.org/scene.ply', format: 'point_cloud_ply', vertices: 12 }], issues: [],
    loadUrl: 'https://example.org/scene.ply', delivery: 'browser_readable', summary: 'XYZ PLY header checked.', scope: 'Original header only.', browserChecks: [] };
  const snapshot = applyDatasetAudit(catalog({ hfRows: rows }), { schemaVersion: 1, checkedAt: result.checkedAt, viewerVersion: '0.16.14', results: [result] }, rows);
  assert.equal(snapshot.entries.length, 1);
  assert.equal(snapshot.entries[0].id, catalog().entries[0].id);
  assert.deepEqual(snapshot.entries[0].formats, ['XYZ point-cloud PLY']);
  assert.equal(snapshot.importSummary.hfEntries, 1);
});

test('an asynchronous decoder rejection overrides a successful byte read or early import UI state', () => {
  const url = 'https://example.org/new-version.spz';
  const result = { sourceId: 'hf:owner/dataset', level: 'header_checked', revision: 'abc', checkedAt: '2026-10-16T00:00:00Z',
    formats: ['spz_v4'], loadUrl: url, probes: [{ url }], issues: [], delivery: 'server_readable' };
  const browser = { origin: 'https://colmapview.opsiclear.com', results: [{ url, delivery: 'browser_readable', checkedAt: result.checkedAt }] };
  const viewer = { results: [{ sourceId: result.sourceId, sourceUrl: url, status: 'failed', imported: true,
    decoderError: 'Invalid gzip header', scope: 'Decoder rejected the original file.' }] };
  const audit = makeDatasetAudit({ results: [result] }, { results: [] }, browser, '0.16.14', viewer);
  const entry = applyDatasetAudit(catalog(), audit).entries[0];
  assert.equal(entry.statusLabel, 'Conversion needed');
  assert.equal(entry.viewerUrl, undefined);
  assert.match(entry.description, /failed decoding/);
});

test('delivery and checked-link filters distinguish transport from format evidence', () => {
  const base = render.catalogSummary(catalog().entries[0]);
  const entries = [{ ...base, delivery: 'browser_readable', hasViewer: true }, { ...base, id: 'other', delivery: 'gated', hasViewer: false }];
  const filters = { query: '', provider: '', license: '', status: '', delivery: 'gated' };
  assert.equal(render.filterCatalog(entries, filters).length, 1);
  assert.equal(render.filterCatalog(entries, { ...filters, viewer: 'available' }).length, 0);
  assert.equal(render.filterCatalog(entries, { ...filters, delivery: '', viewer: 'available' }).length, 1);
  assert.equal(render.isCatalogSummary({ ...base, hasViewer: 'yes' }), false);
});

test('loose public models use a manifest instead of treating a virtual directory as a downloadable object', () => {
  const snapshot = catalog({ hfRows: [], publicRows: [publicRow({ data_url: 'https://example.org/colmap/0/' })] });
  const original = snapshot.entries[0];
  original.facts.push({ label: 'RGB base URL', value: 'https://example.org/photos/' });
  const result = { sourceId: original.sourceId, level: 'header_checked', checkedAt: '2026-10-16T00:00:00Z',
    formats: ['colmap'], probes: ['cameras.bin', 'images.bin', 'points3D.bin'].map(path => ({ path, url: `https://example.org/colmap/0/${path}` })),
    issues: [], loadUrl: 'https://example.org/colmap/0/', delivery: 'browser_readable', summary: 'Native headers checked.', scope: 'Sampled source files.', browserChecks: [] };
  const entry = applyDatasetAudit(snapshot, { schemaVersion: 1, checkedAt: result.checkedAt, viewerVersion: '0.16.14', results: [result] }).entries[0];
  assert.equal(entry.modelManifest.baseUrl, 'https://example.org/');
  assert.equal(entry.modelManifest.files.points3D, 'colmap/0/points3D.bin');
  assert.equal(entry.modelManifest.imagesPath, 'photos/');
  assert.equal(new URL(entry.viewerUrl).searchParams.get('url'), entry.dataUrl);
  assert.match(entry.dataUrl, /\.manifest\.json$/);
  assert.equal(entry.sourceUrl, original.sourceUrl);
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
