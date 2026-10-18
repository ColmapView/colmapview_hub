import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { applyCatalogReviews, buildCatalog, parseCsv, publicUrl, sha256 } from '../scripts/catalog/catalog-import.mjs';
import { catalogRenderer } from '../scripts/build/renderer.mjs';
import { applyDatasetAudit, makeDatasetAudit, requiredProbeUrls, openingRequirement } from '../scripts/catalog/dataset-audit-import.mjs';
import { isAccessRestricted, publicationSnapshot } from '../scripts/catalog/catalog-publication.mjs';
import { applyLicenseCategories } from '../scripts/catalog/license-categories.mjs';

const render = await catalogRenderer();

test('both catalog builds share the access-restriction policy fixtures', async () => {
  const cases = JSON.parse(await readFile('tests/fixtures/catalog-publication.json', 'utf8'));
  for (const item of cases) assert.equal(isAccessRestricted(item.entry), item.excluded, item.name);
});

test('publication removes gated and nonopening collections from all public metadata and recounts retained sources', () => {
  const entry = (id, overrides = {}) => ({ id, sourceId: `hf:${id}`, provider: 'huggingface', facts: [], access: 'public', ...overrides });
  const catalog = { entries: [entry('keep'), entry('gated', { access: 'gated' }), entry('stale'), entry('missing-audit', { access: 'gated' }),
    entry('scene', { provider: 'public', sourceId: 'public:scene', facts: [{ label: 'Collection', value: 'Scenes' }] })],
  importSummary: { hfCandidates: 10 }, auditSummary: { checkedAt: '2026-10-16' } };
  const audit = { scope: 'Original inventory.', results: [
    { sourceId: 'hf:keep', level: 'header_checked', delivery: 'browser_readable',
      browserChecks: [{ url: 'https://example.com/model' }, { url: 'https://example.com/model' }], viewerImport: { status: 'passed' } },
    { sourceId: 'hf:gated', level: 'unverified', delivery: 'not_tested' },
    { sourceId: 'hf:stale', gated: 'auto', level: 'unverified', delivery: 'gated', accessChecks: [{}] },
    { sourceId: 'hf:missing-audit', level: 'unavailable', delivery: 'not_tested' },
    { sourceId: 'hf:rejected-gated', gated: 'manual', level: 'no_native_assets', delivery: 'gated' },
    { sourceId: 'hf:rejected-public', level: 'no_native_assets', delivery: 'not_tested' }],
  browserCoverage: { completed: 2, total: 2 }, evidenceRefresh: { checkedAt: '2026-10-17', browserUrls: 2, accessChecks: 1 } };
  const registry = { checkedAt: '2026-10-16', sources: ['keep', 'gated', 'stale', 'missing-audit'].map((id, index) =>
    ({ datasetId: id, sourceId: `hf:${id}`, count: index + 2, listingComplete: id === 'keep' })) };
  const before = JSON.stringify({ catalog, audit, registry });
  const published = publicationSnapshot(catalog, audit, registry, { checkedAt: '2026-10-16', total: 2,
    sources: [{ id: 'keep', count: 1 }, { id: 'scene', count: 1 }, { id: 'gated', count: 0 }], incompleteCollections: 0 });
  assert.deepEqual(published.snapshot.entries.map(entry => entry.id), ['keep', 'scene']);
  assert.deepEqual(published.audit.results.map(row => row.sourceId), ['hf:keep']);
  assert.equal(published.snapshot.importSummary.hfEntries, 1);
  assert.equal(published.snapshot.importSummary.publicEntries, 1);
  assert.equal(published.snapshot.individualSummary, undefined);
  assert.equal(published.snapshot.assetInventorySummary.entries, 3);
  assert.equal(published.snapshot.sceneSummary.entries, 2);
  assert.equal(published.snapshot.sceneSummary.sourceEntriesWithModels, 2);
  assert.equal(published.snapshot.sceneSummary.incompleteCollections, 0);
  assert.equal(published.snapshot.auditSummary.sourcesAudited, 1);
  assert.deepEqual(published.snapshot.auditSummary.delivery, { browser_readable: 1 });
  assert.equal(published.audit.evidenceRefresh.browserUrls, 1);
  assert.equal(published.audit.evidenceRefresh.accessChecks, 0);
  assert.equal(published.audit.evidenceRefresh.directSamples, 1);
  assert.equal(JSON.stringify({ catalog, audit, registry }), before, 'research evidence is not mutated');
  for (const excluded of ['gated', 'stale', 'missing-audit']) {
    assert(!published.snapshot.entries.some(entry => entry.id === excluded));
  }
});

test('license categories recognize explicit terms and keep ambiguous or mixed permissions unresolved', () => {
  for (const license of ['MIT', ' apache-2.0 ', 'cc-by-4.0', 'cc-by-sa-4.0', 'gpl-3.0', 'odbl', 'cdla-permissive-2.0', 'mit | cc-by-4.0 | apache-2.0']) {
    assert.equal(render.classifyLicense(license), 'commercial', license);
  }
  for (const license of ['cc-by-nc-4.0', 'cc-by-nc-nd-4.0', 'cc-by-nc-sa-3.0', 'fair-noncommercial-research-license',
    'waymo-dataset-license-non-commercial',
    'Custom Niantic non-commercial dataset agreement; file format itself is plain text/JPEG']) {
    assert.equal(render.classifyLicense(license), 'non-commercial', license);
  }
  for (const license of ['', 'Not specified', 'other', 'unknown', 'cc', 'apple-amlr', 'not independently confirmed',
    'CC BY 4.0; author LICENSE-DATA.md', 'MIT for code only', 'mit | other', 'mit | cc-by-nc-4.0', 'apache-2.0 AND cc-by-nc-4.0', 'mit |', 'constructor']) {
    assert.equal(render.classifyLicense(license), 'not-specified', license);
  }
});

test('license category refresh preserves exact terms and identity, is repeatable, and reaches public metadata', async () => {
  const snapshot = catalog({ hfRows: [hf(), hf({ id: 'owner/nc', license: 'cc-by-nc-4.0' }), hf({ id: 'owner/custom', license: 'other' })] });
  const before = snapshot.entries.map(entry => [entry.id, entry.license, entry.viewerUrl]);
  await applyLicenseCategories(snapshot);
  assert.deepEqual(snapshot.entries.map(entry => [entry.id, entry.license, entry.viewerUrl]), before);
  assert.deepEqual(snapshot.entries.map(entry => entry.licenseCategory).sort(), ['commercial', 'non-commercial', 'not-specified']);
  const once = JSON.stringify(snapshot);
  await applyLicenseCategories(snapshot);
  assert.equal(JSON.stringify(snapshot), once);
  const summaries = snapshot.entries.map(render.catalogSummary);
  for (const licenseCategory of render.LICENSE_CATEGORIES) {
    const result = summaries.filter(entry => entry.licenseCategory === licenseCategory);
    assert.equal(result.length, 1);
    assert.equal(result[0].licenseCategory, licenseCategory);
    assert.match(render.catalogEntryPage(snapshot.entries.find(entry => entry.id === result[0].id)), /License category/);
  }
  assert.equal(render.isCatalogSummary({ ...summaries[0], licenseCategory: 'anything' }), false);
  const olderSummary = { ...summaries.find(entry => entry.licenseCategory === 'commercial') };
  delete olderSummary.licenseCategory;
  assert.equal(render.isCatalogSummary(olderSummary), true);
  assert.equal(render.licenseCategory(olderSummary), 'commercial');
});
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

test('source-wide excluded RGB remains explicit without blocking a checked native model', () => {
  const snapshot = catalog();
  const sourceImages = { status: 'not_included', summary: 'The publisher excludes RGB images. Masks are included separately.', sourceUrl: 'https://example.org/README.md' };
  const url = 'https://huggingface.co/datasets/owner/dataset/tree/abc/scene';
  applyDatasetAudit(snapshot, { schemaVersion: 1, checkedAt: '2026-10-17', viewerVersion: '0.16.14', results: [{ sourceId: 'hf:owner/dataset',
    checkedAt: '2026-10-17', level: 'header_checked', delivery: 'browser_readable', formats: ['colmap'], loadUrl: url,
    summary: 'Model loaded; RGB excluded.', scope: 'Exact model only.', sourceImages, license: 'waymo-dataset-license-non-commercial',
    viewerImport: { status: 'passed', sourceUrl: url, scope: 'Exact model.' }, probes: [], issues: [], browserChecks: [] }] });
  const entry = snapshot.entries[0];
  assert.equal(entry.statusLabel, 'Model checked; RGB not included');
  assert.equal(entry.verification.sourceImages.status, 'not_included');
  assert.equal(render.catalogSummary(entry).hasViewer, true);
  assert.equal(render.catalogSummary(entry).licenseCategory, 'non-commercial');
  assert.match(render.catalogEntryPage(entry), /Source RGB/);
  assert.match(render.catalogEntryPage(entry), /publisher excludes RGB/);
});

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

test('summary validation requires a boolean checked-link flag', () => {
  const base = render.catalogSummary(catalog().entries[0]);
  assert.equal(render.isCatalogSummary({ ...base, hasViewer: true }), true);
  assert.equal(render.isCatalogSummary({ ...base, hasViewer: false }), true);
  assert.equal(render.isCatalogSummary({ ...base, hasViewer: 'yes' }), false);
});

test('a readable PLY header inside a model-free ZIP cannot create a direct viewer action', () => {
  const url = 'https://huggingface.co/datasets/owner/dataset/resolve/abc/models.zip';
  const result = { sourceId: 'hf:owner/dataset', level: 'header_checked', revision: 'abc', checkedAt: '2026-10-17T00:00:00Z',
    formats: ['point_cloud_ply'], loadUrl: url, probes: [{ url, members: 2, completeDirectory: true, modelCount: 0,
      probes: [{ path: 'models/airplane.ply', format: 'point_cloud_ply' }] }], issues: [], delivery: 'browser_readable',
    summary: 'Contained PLY header checked.', scope: 'One contained member.', browserChecks: [] };
  const entry = applyDatasetAudit(catalog(), { schemaVersion: 1, checkedAt: result.checkedAt, viewerVersion: '0.16.14', results: [result] }).entries[0];
  assert.equal(entry.verification.level, 'header_checked');
  assert.equal(entry.verification.opening.status, 'extraction_required');
  assert.equal(entry.viewerUrl, undefined);
  assert.equal(entry.dataUrl, url);
  assert.match(entry.statusLabel, /Extract archive/);
  assert.match(render.catalogEntryPage(entry), /Download archive/);
  assert.doesNotMatch(render.catalogEntryPage(entry), /Try in ColmapView/);
  assert.equal(openingRequirement({ ...result, formats: ['colmap'], probes: [{ ...result.probes[0], modelCount: 1 }] }), undefined);
  assert.equal(openingRequirement({ ...result, probes: [{ ...result.probes[0], completeDirectory: false }] }), undefined);
});

test('gated sources keep format evidence but cannot offer direct file or viewer actions', () => {
  const result = { sourceId: 'hf:owner/dataset', level: 'file_set_only', revision: 'abc', checkedAt: '2026-10-17T00:00:00Z',
    formats: [], probes: [], issues: [], delivery: 'gated', gated: 'auto', summary: 'Filenames only.', scope: 'Public listing.', browserChecks: [] };
  const entry = applyDatasetAudit(catalog(), { schemaVersion: 1, checkedAt: result.checkedAt, viewerVersion: '0.16.14', results: [result] }).entries[0];
  assert.equal(entry.statusLabel, 'Access required');
  assert.equal(entry.viewerUrl, undefined);
  const html = render.catalogEntryPage({ ...entry, viewerUrl: 'https://example.org/invalid-old-link', candidateViewerUrl: 'https://example.org/invalid-trial' });
  assert.match(html, /Get source access/);
  assert.match(html, /download them there/);
  assert.doesNotMatch(html, /Try in ColmapView|Try listed model|invalid-old-link|invalid-trial|sign in to Hugging Face in ColmapView/);
});

test('a failed exact import cannot become an unchecked trial after a browser read', () => {
  const result = { sourceId: 'hf:owner/dataset', level: 'header_checked', revision: 'abc', checkedAt: '2026-10-17T00:00:00Z',
    formats: ['point_cloud_ply'], loadUrl: 'https://example.org/invalid.ply', probes: [], issues: [], delivery: 'browser_readable',
    summary: 'Header checked.', scope: 'One file.', browserChecks: [], viewerImport: { status: 'failed', scope: 'Original file.', error: 'Invalid body' } };
  const entry = applyDatasetAudit(catalog(), { schemaVersion: 1, checkedAt: result.checkedAt, viewerVersion: '0.16.14', results: [result] }).entries[0];
  assert.equal(entry.viewerUrl, undefined);
  assert.equal(entry.verification.opening.status, 'load_failed');
  assert.match(render.catalogEntryPage(entry), /Invalid body/);
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
    assert.equal(entry.licenseCategory, render.classifyLicense(entry.license), entry.id);
    assert(publicUrl(entry.sourceUrl));
    assert.doesNotMatch(render.catalogEntryPage(entry), /<(?:img|iframe|canvas)\b|og:image/);
  }
  assert(snapshot.sources.every(source => /^[a-f0-9]{64}$/.test(source.sha256)));
  assert.equal(snapshot.sources.find(source => source.kind === 'license-categories').sha256, sha256((await readFile('src/shared/license-categories.ts', 'utf8')).replace(/\r\n/g, '\n')));
  const headers = await readFile('public/_headers', 'utf8');
  assert.match(headers, /\/hub\/datasets\/\*[\s\S]*Cache-Control: public, no-cache, must-revalidate, no-transform/);
  assert.match(headers, /Cloudflare-CDN-Cache-Control: no-store/);
});
