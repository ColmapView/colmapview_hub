import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { catalogRenderer } from '../scripts/catalog-renderer.mjs';
import { applyIndividualListings } from '../scripts/individual-listings.mjs';
import { applyDatasetLabels } from '../scripts/dataset-labels.mjs';

const render = await catalogRenderer();
const verified = JSON.parse(readFileSync('tests/fixtures/verified-scene-proof.json', 'utf8'));

test('scene publication matches the viewer action gates', () => {
  const cases = JSON.parse(readFileSync('tests/fixtures/scene-publication.json', 'utf8'));
  for (const item of cases) {
    const source = { provider: item.provider || 'huggingface', access: item.access || 'public' };
    const proof = { ...(item.verified ? verified : {}), ...item.proof };
    if (item.proof?.sceneValidation) proof.sceneValidation = { ...verified.sceneValidation, ...item.proof.sceneValidation };
    const record = ['id', 0, item.kind, 'scene', 'COLMAP', item.archive || null, null, proof];
    assert.equal(render.canOpenIndividual(record, source), item.publish, item.name);
  }
});

test('photo availability is displayed separately without changing model actions', () => {
  for (const [status, label] of [['partial', 'Photos partially available'], ['path_policy_required', 'Photos need setup'],
    ['companion_archive', 'Photos in a separate ZIP'], ['not_found', 'No source photos found'], ['not_included', 'Photos not included']]) {
    const item = row(0, { 7: nativePhotoProof(status) });
    const summary = render.individualSummary(item, source);
    assert.equal(summary.photoStatus, status);
    assert.equal(summary.hasViewer, true);
    assert.match(render.catalogCard(summary), new RegExp(label));
    assert.match(render.catalogEntryPage(render.individualEntry(item, source, parent)), new RegExp(label === 'Photos not included' ? 'Not included by publisher' : label));
    assert.equal(render.isCatalogSummary(summary), true);
  }
  assert.equal(render.isCatalogSummary({ ...render.individualSummary(row(), source), photoStatus: '__proto__' }), false);
});

test('photo path rules preserve the model URL and expose checked source paths', () => {
  const audit = { status: 'path_policy_required', checkedAt: '2026-10-17', listingComplete: true,
    summary: 'Photos need their explicit mapping.', policy: 'authoritative_json_mapping_required', sceneRoot: 'colmap/scene',
    mediaScope: 'cache/scene/images', mappingFile: 'colmap/scene/mapping.json', associationFile: 'colmap/scene/manifest.json', mappingCheck: { entries: 297, matched: 297 },
    samplePath: 'cache/scene/images/FRONT/00000000.png', sampleBrowserRead: true, samplePixels: 'decoded',
    policyNote: 'Keep the exact frame mapping; do not infer zero padding.' };
  const item = row(0, { 7: { ...nativePhotoProof('path_policy_required'), photoAudit: audit } });
  const entry = render.individualEntry(item, source, parent);
  assert.equal(entry.viewerUrl, verified.viewerUrl);
  assert.equal(entry.verification.photoAudit, audit);
  const html = render.catalogEntryPage(entry);
  assert.match(html, /Required photo scope/);
  assert.match(html, /cache\/scene\/images/);
  assert.match(html, /297\/297/);
  assert.match(html, /colmap\/scene\/mapping\.json/);
  assert.match(html, /Photo association manifest/);
  assert.match(html, /colmap\/scene\/manifest\.json/);
  assert.doesNotMatch(html, /Photos checked.*all original photos/s);
});

test('cards expose scene contents without treating pose metadata or unknown PLY files as photos or splats', () => {
  const availableData = { cameras: { status: 'checked', count: 2 }, point_cloud: { status: 'checked', count: 43 },
    images: { status: 'needs_setup' }, masks: { status: 'listed', count: 12 }, splats: { status: 'checked' }, meshes: { status: 'checked' } };
  const summary = render.individualSummary(row(0, { 7: { ...nativePhotoProof('path_policy_required'), availableData } }), source);
  assert.deepEqual(summary.availableData, availableData);
  const html = render.catalogCard(summary);
  assert.match(html, /aria-label="Available data"/);
  for (const kind of Object.keys(availableData)) assert.match(html, new RegExp(`data-asset="${kind}"`));
  assert.match(html, /Images · setup/);
  assert.match(html, /Masks · listed/);
  assert.match(html, /43 points/);
  assert.equal(render.isCatalogSummary(summary), true);
  assert.equal(render.isCatalogSummary({ ...summary, availableData: { splats: { status: 'guessed' } } }), false);
  assert.equal(render.isCatalogSummary({ ...summary, availableData: { unknown: { status: 'listed' } } }), false);
  const modelOnly = render.individualSummary(row(0, { 7: { ...nativePhotoProof('not_included'), availableData: { cameras: { status: 'checked' } } } }), source);
  assert.doesNotMatch(render.catalogCard(modelOnly), /data-asset="(?:images|splats)"/);
});

test('simple scene cards keep camera and point totals visible with model details in metadata', () => {
  const proof = { ...nativePhotoProof('not_included'), sceneCompatibility: {
    ...nativePhotoProof('not_included').sceneCompatibility, cameras: 1, images: 227, points: 23659 } };
  const summary = render.individualSummary(row(0, { 7: proof }), source);
  assert.deepEqual(summary.sceneStats, { cameraPoses: 227, cameraModels: 1, points: 23659 });
  const html = render.catalogCard(summary);
  assert.match(html, /aria-label="Scene statistics"/);
  assert.match(html, /Cameras<\/dt><dd data-stat="cameraPoses">227/);
  assert.match(html, /Camera models<\/dt><dd data-stat="cameraModels">1/);
  assert.match(html, /Points<\/dt><dd data-stat="points">23,659/);
  const visible = html.split('<div class="dataset-metadata"')[0];
  assert.doesNotMatch(visible, /Camera models|dataset-card-footer|data-photo-status/);
  assert.match(visible, /dataset-statistics-compact/);
  assert.match(html, /data-photo-status="not_included">Photos not included/);
  assert.equal(render.isCatalogSummary(summary), true);
  const entry = render.individualEntry(row(0, { 7: proof }), source, parent);
  assert.deepEqual(render.catalogSummary(entry).sceneStats, summary.sceneStats);
  assert.match(render.catalogEntryPage(entry), /data-stat="points">23,659/);
});

test('unknown totals stay unknown, zero points stay zero and companion counts cannot replace the reconstruction', () => {
  const proof = nativePhotoProof('not_included');
  proof.sceneCompatibility = { ...proof.sceneCompatibility, cameras: null, images: null, points: null };
  proof.availableData = { cameras: { status: 'checked' }, point_cloud: { status: 'checked', count: 999 } };
  const item = row(0, { 7: proof });
  const summary = render.individualSummary(item, source);
  assert.deepEqual(summary.sceneStats, { cameraPoses: null, cameraModels: null, points: null });
  assert.equal((render.catalogCard(summary).match(/>Unknown<\/dd>/g) || []).length, 3);
  assert.equal(render.isCatalogSummary(summary), true);
  const model = render.individualEntry(item, source, { ...parent, sceneStats: { cameraPoses: 99, cameraModels: 99, points: 99 } });
  assert.deepEqual(model.sceneStats, summary.sceneStats);
  proof.sceneCompatibility.points = 0;
  const zero = render.individualSummary(item, source);
  assert.equal(zero.sceneStats.points, 0);
  assert.match(render.catalogCard(zero), /data-stat="points">0<\/dd>/);
  assert.equal(render.isCatalogSummary(zero), true);
  for (const invalid of [-1, 1.5, '123', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(render.isCatalogSummary({ ...summary, sceneStats: { ...summary.sceneStats, points: invalid } }), false);
  }
  const stronger = render.individualSummary(row(0, { 7: { ...proof, sceneValidation: { ...verified.sceneValidation, cameras: 3, images: 7, points: 0 } } }), source);
  assert.deepEqual(stronger.sceneStats, { cameraPoses: 7, cameraModels: 3, points: 0 });
});

function explicitManifestProof() {
  const selection = 'e'.repeat(64);
  const manifest = { url: `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${selection}.manifest.json`,
    sha256: 'a'.repeat(64), selectionSha256: selection, counts: { cameras: 1, images: 2, points: 350710 },
    pointSource: 'scene/sparse/0/points3D.ply', pointFormat: 'xyz_ply', photoCount: 2, maskCount: 2, maskRole: 'unknown',
    exportSha256: 'b'.repeat(64), viewerCommit: 'c'.repeat(40), viewerVersion: '0.17.5' };
  const proof = nativePhotoProof('sample_checked');
  proof.sceneCompatibility = { ...proof.sceneCompatibility, cameras: 1, images: 2, points: 0 };
  return { ...proof, sceneManifest: manifest, viewerUrl: 'https://colmapview.opsiclear.com/?url=' + encodeURIComponent(manifest.url) };
}

test('selected manifest totals and launch target follow the checked companion while native evidence stays zero', () => {
  const proof = explicitManifestProof();
  const item = row(0, { 7: proof });
  assert.equal(render.canOpenIndividual(item, source), true);
  assert.deepEqual(render.individualSummary(item, source).sceneStats, { cameraPoses: 2, cameraModels: 1, points: 350710 });
  const entry = render.individualEntry(item, source, parent);
  assert.equal(entry.viewerUrl, proof.viewerUrl);
  assert.equal(entry.verification.sceneCompatibility.points, 0);
  const html = render.catalogEntryPage(entry);
  assert.match(html, /data-stat="points">350,710/);
  assert.match(html, /Native 3D points/);
  assert.match(html, /Scene manifest/);
  assert.match(html, /not qualified as COLMAP feature masks/);
  const stronger = { ...proof, level: 'scene_verified', delivery: 'browser_readable', sceneCompatibility: undefined,
    sceneValidation: { ...verified.sceneValidation, cameras: 1, images: 2, points: 0 } };
  assert.equal(render.canOpenIndividual(row(0, { 7: stronger }), source), true);
  assert.equal(render.individualSummary(row(0, { 7: stronger }), source).sceneStats.points, 350710);
});

test('malformed or mismatched manifest evidence cannot keep a viewer action', () => {
  for (const change of [
    proof => { proof.viewerUrl = verified.viewerUrl; },
    proof => { proof.sceneManifest.counts.images = 3; },
    proof => { proof.sceneManifest.pointFormat = '__proto__'; },
    proof => { proof.sceneManifest.sha256 = ''; },
    proof => { proof.sceneCompatibility.points = 2; },
    proof => { proof.sceneManifest.photoCount = 3; },
    proof => { proof.sceneManifest.url = 'https://unrelated.test/manifest.json'; },
  ]) {
    const proof = explicitManifestProof();
    change(proof);
    assert.equal(render.canOpenIndividual(row(0, { 7: proof }), source), false);
    assert.equal(render.individualSummary(row(0, { 7: proof }), source).sceneStats.points, proof.sceneCompatibility.points);
  }
  const proof = explicitManifestProof();
  proof.sceneManifest.pointFormat = 'colmap_text';
  proof.sceneManifest.pointSource = 'scene/sparse/0/points3D.txt';
  proof.sceneManifest.counts.points = 0;
  proof.sceneManifest.photoCount = 1;
  proof.sceneManifest.maskCount = 1;
  assert.equal(render.canOpenIndividual(row(0, { 7: proof }), source), true);
  assert.equal(render.individualSummary(row(0, { 7: proof }), source).sceneStats.points, 0);
});

test('public manifest settings assets have their own static CORS rule', () => {
  const headers = readFileSync('public/_headers', 'utf8');
  assert.match(headers, /\/hub\/datasets\/individual\/manifests\/\*\.state\.json\r?\n\s+Access-Control-Allow-Origin: \*/);
  assert.doesNotMatch(headers, /\/hub\/datasets\/individual\/manifests\/\*\r?\n\s+Access-Control-Allow-Origin: \*/);
  assert.match(readFileSync('wrangler.jsonc', 'utf8'), /!\/hub\/datasets\/individual\/\*/);
});

test('statistics evidence names only the text files completely read in a mixed-format model', () => {
  const proof = nativePhotoProof('not_included');
  proof.sceneCompatibility = { ...proof.sceneCompatibility, cameras: 1, images: 12, points: 0,
    countAudit: { method: 'viewer_native_text_parse', checkedAt: '2026-10-18', viewerCommit: 'b'.repeat(40),
      files: { points3d: { path: 'scene/points3D.txt', count: 0, bytes: 0, sha256: 'c'.repeat(64) } } } };
  const entry = render.individualEntry(row(0, { 7: proof }), source, parent);
  const html = render.catalogEntryPage(entry);
  assert.match(html, /Complete text files \(points3D\.txt\) parsed/);
  assert.doesNotMatch(html, /Complete camera, pose and point files parsed/);
  assert.match(html, /data-stat="cameraPoses">12/);
  assert.match(html, /data-stat="points">0/);
  assert.match(html, /Not included by publisher/);
});

const squareThumbnail = { url: '/hub/datasets/individual/thumbnails/' + 'a'.repeat(64) + '.jpg', width: 320, height: 320,
  sourcePath: 'scene/images/a.jpg', sourceSha256: 'b'.repeat(64), datasetLicense: 'cc-by-4.0', license: 'cc-by-sa-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', creditUrl: 'https://commons.wikimedia.org/wiki/File:a.jpg',
  attribution: 'Original photographer', crop: 'center_square' };

test('square previews remain same-origin, attributed and commercially licensed at both source and photo level', () => {
  const summary = render.individualSummary(row(0, { 7: { ...nativePhotoProof('sample_checked'), thumbnail: squareThumbnail } }), source);
  const html = render.catalogCard(summary);
  assert.equal(render.isCatalogSummary(summary), true);
  assert.match(html, /class="dataset-thumbnail"/);
  assert.match(html, /width="320" height="320" loading="lazy" decoding="async"/);
  assert.match(html, /Original photographer/);
  assert.match(html, /cc-by-sa-4.0/);
  const visible = html.split('<div class="dataset-metadata"')[0];
  assert.doesNotMatch(visible, /figcaption|square crop|Original photographer|cc-by-sa-4.0/);
  assert.match(html, /dataset-photo-credit.*Original photographer.*cc-by-sa-4.0.*Cropped/);
  const detail = render.catalogEntryPage(render.individualEntry(row(0, { 7: { ...nativePhotoProof('sample_checked'), thumbnail: squareThumbnail } }), source, parent));
  assert.match(detail, /Center-square crop of the first available registered photograph/);
  for (const license of ['cc-by-nc-4.0', 'unknown']) {
    assert.doesNotMatch(render.catalogCard({ ...summary, license }), /class="dataset-thumbnail"/);
    assert.doesNotMatch(render.catalogCard({ ...summary, thumbnail: { ...squareThumbnail, license } }), /class="dataset-thumbnail"/);
  }
  assert.doesNotMatch(render.catalogCard({ ...summary, license: 'unknown', licenseCategory: 'commercial' }), /class="dataset-thumbnail"/);
  for (const url of ['https://huggingface.co/photo.jpg', '//example.com/photo.jpg', '/hub/datasets/individual/thumbnails/../private.jpg']) {
    assert.equal(render.isCatalogSummary({ ...summary, thumbnail: { ...squareThumbnail, url } }), false);
  }
  assert.equal(render.isCatalogSummary({ ...summary, thumbnail: { ...squareThumbnail, creditUrl: 'javascript:alert(1)' } }), false);
});

test('card titles omit storage paths and retain scene names with model variants', () => {
  const cases = [
    ['data/i2slam_colmap/scene0024_01', 'scene0024_01 · i2slam_colmap'],
    ['scene0000_00/sparse/init', 'scene0000_00 · init'],
    ['scene0000_00/sparse/refined_aligned', 'scene0000_00 · refined_aligned'],
    ['inputs/cone/Instance_1/joint/undistorted/readout', 'cone · Instance_1 · joint · undistorted · readout'],
    ['courtyard/dslr_calibration_jpg', 'courtyard · dslr_calibration_jpg'],
    ['scenes/1%2F15_Pylypa_Orlyka_Street,_Kyiv/0', '1/15_Pylypa_Orlyka_Street,_Kyiv · 0'],
    ['reconstructions/ahunamons/reconstruction_roma_LunarLambert/final', 'ahunamons · reconstruction_roma_LunarLambert · final'],
    ['scenes/malformed%ZZ/0', 'malformed%ZZ · 0'],
  ];
  for (const [title, expected] of cases) {
    const entry = { ...render.individualSummary(row(), source), title };
    const html = render.catalogCard(entry);
    assert.ok(html.includes(`>${expected}</a></h2>`), title);
    assert.ok(html.includes(`<p class="dataset-metadata-title">${title}</p>`), title);
    assert.equal(entry.title, title);
  }
});

test('a scene cannot inherit the collection thumbnail or its sibling asset list', () => {
  const entry = render.individualEntry(row(0, { 7: nativePhotoProof('not_included') }), source,
    { ...parent, thumbnail: squareThumbnail, availableData: { images: { status: 'checked' }, splats: { status: 'checked' } } });
  assert.equal(entry.thumbnail, undefined);
  assert.equal(entry.availableData, undefined);
  assert.doesNotMatch(render.catalogCard(render.catalogSummary(entry)), /dataset-thumbnail|data-asset="splats"/);
  assert.match(render.catalogCard(render.catalogSummary(entry)), /dataset-preview-placeholder.*No photo:/);
});

test('placeholder cards distinguish absent photos from unavailable previews', () => {
  const summary = render.individualSummary(row(), source);
  for (const photoStatus of ['not_found', 'not_included', 'review_required', 'sample_checked', 'path_policy_required', undefined]) {
    const html = render.catalogCard({ ...summary, photoStatus });
    assert.match(html, /dataset-preview-placeholder/);
    assert.ok(html.includes(['not_found', 'not_included'].includes(photoStatus) ? '<span>No photo</span>' : '<span>No preview</span>'));
    assert.doesNotMatch(html, /<img|dataset-photo-credit|data-asset="images"/);
  }
  const licensed = { ...summary, photoStatus: 'sample_checked', thumbnail: squareThumbnail };
  assert.doesNotMatch(render.catalogCard(licensed), /dataset-preview-placeholder/);
  assert.match(render.catalogCard({ ...licensed, license: 'cc-by-nc-4.0' }), /dataset-preview-placeholder/);
});
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
const nativePhotoProof = status => ({ ...parent.verification, level: 'native_layout_checked', statusLabel: 'Native COLMAP layout checked',
  viewerUrl: verified.viewerUrl, photoAvailability: status, sceneCompatibility: { status: 'native_headers_checked', revision: 'a'.repeat(40),
    cameraRecordChecked: true, poseRecordChecked: true, cameras: 1, images: 2, points: 3 } });
const fixture = () => {
  const rows = [row(), row(1, { 7: { ...parent.verification, ...verified, statusLabel: parent.statusLabel, viewerUrl: parent.viewerUrl } }), row(2),
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
  assert.equal(model.candidateViewerUrl, undefined);
  assert.equal(render.datasetPath(model), `/hub/datasets/entry/${model.id}`);
  assert.equal(render.catalogSummary(model).hasViewer, false);
});

test('camera datasets use scene titles and keep split files inside the detail page', () => {
  const item = row(0, { 2: 'camera-scene', 3: 'bonsai', 4: 'Camera metadata and scene assets',
    6: { 'metadata:transforms_train.json': 'bonsai/transforms_train.json', 'metadata:transforms_test.json': 'bonsai/transforms_test.json' },
    8: { listedAssets: 100, linkedAssets: 2, linksTruncated: true } });
  const summary = render.individualSummary(item, source);
  assert.equal(summary.title, 'bonsai');
  assert.equal(summary.itemKind, 'Camera dataset');
  const scene = render.individualEntry(item, source, parent);
  assert.equal(scene.dataUrl, 'https://huggingface.co/datasets/owner/dataset/tree/abc/bonsai');
  assert.equal(scene.candidateViewerUrl, undefined);
  const page = render.catalogEntryPage(scene);
  assert.match(page, /Showing 2 asset links/);
  assert.match(page, /bonsai\/transforms_train\.json/);
  assert.match(page, /all 100 listed assets/);
  assert.equal(render.individualSummary(row(0, { 3: 'sparse/1' }), source).title, source.label);
});

test('only verified camera-and-photo cards open directly; unchecked or blocked records keep source details', () => {
  const native = render.individualSummary(row(0, { 7: { ...parent.verification, ...verified } }), source);
  assert.equal(native.openUrl, `/hub/datasets/open/${row()[0]}`);
  assert.equal(native.hasViewer, true);
  const html = render.catalogCard(native);
  assert.match(html, /class="dataset-open" href="\/hub\/datasets\/open\/data-/);
  assert.doesNotMatch(html, /Try · unchecked/);
  assert.match(html, /aria-controls="metadata-data-/);
  assert.match(html, /Full metadata/);
  for (const [record, origin] of [[row(), source], [row(0, { 5: 'archive.zip' }), source], [row(), { ...source, access: 'gated' }],
    [row(0, { 2: 'obj' }), source], [row(0, { 7: { ...parent.verification, level: 'conversion_needed' } }), source],
    [row(0, { 7: { ...parent.verification, delivery: 'access_denied', viewerUrl: parent.viewerUrl } }), source],
    [row(0, { 5: 'archive.zip', 7: { ...parent.verification, viewerUrl: parent.viewerUrl } }), source],
    [row(0, { 7: { ...parent.verification, opening: { status: 'load_failed', summary: 'Failed import.' }, viewerUrl: parent.viewerUrl } }), source]]) {
    const summary = render.individualSummary(record, origin);
    assert.equal(summary.openUrl, undefined);
    assert.equal(summary.hasViewer, false);
    assert.equal(render.individualEntry(record, origin, parent).viewerUrl, undefined);
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

test('gated listed PLY files show access required without a download, viewer or trial action', () => {
  const path = 'generated-labels/kaggle-balraj98-modelnet40-princeton-3d-object-dataset/airplane_0048-a83c7315ee13/input/airplane_0048-0138384160df.ply';
  const gatedSource = { ...source, access: 'gated' };
  const gatedParent = { ...parent, access: 'gated' };
  const model = render.individualEntry(row(0, { 2: 'ply', 3: path, 6: null, 7: { ...parent.verification, statusLabel: parent.statusLabel, viewerUrl: parent.viewerUrl } }), gatedSource, gatedParent);
  assert.equal(model.statusLabel, 'Access required');
  assert.equal(model.verification.delivery, 'gated');
  assert.equal(model.viewerUrl, undefined);
  assert.equal(model.candidateViewerUrl, undefined);
  assert.equal(render.individualSummary(row(0, { 2: 'ply', 3: path, 6: null }), gatedSource).hasViewer, false);
  const html = render.catalogEntryPage(model);
  assert.match(html, /Get source access/);
  assert.doesNotMatch(html, />Dataset URL|Try in ColmapView|Try listed model|sign in to Hugging Face in ColmapView/);
});

test('an archive member never inherits a direct archive viewer action or unchecked trial', () => {
  const item = row(0, { 2: 'ply', 3: 'models/airplane.ply', 5: 'models.zip', 6: null,
    7: { ...parent.verification, statusLabel: 'Member headers checked; extraction required', viewerUrl: parent.viewerUrl } });
  const model = render.individualEntry(item, source, parent);
  assert.equal(model.viewerUrl, undefined);
  assert.equal(model.candidateViewerUrl, undefined);
  assert.equal(render.individualSummary(item, source).hasViewer, false);
  assert.equal(model.verification.opening.status, 'extraction_required');
  assert.match(render.catalogEntryPage(model), /Extract models\/airplane.ply/);
});

test('known failed native files cannot regain a trial through the listing fallback', () => {
  const item = row(0, { 2: 'ply', 3: 'failed.ply', 6: null,
    7: { ...parent.verification, statusLabel: 'Sample failed to load', opening: { status: 'load_failed', summary: 'Exact file failed.' } } });
  const model = render.individualEntry(item, source, parent);
  assert.equal(model.viewerUrl, undefined);
  assert.equal(model.candidateViewerUrl, undefined);
  assert.match(render.catalogEntryPage(model), /Exact file failed/);
});

test('known failed browser delivery cannot be relabeled as an unchecked trial', () => {
  for (const delivery of ['access_denied', 'not_found', 'browser_request_failed', 'range_unverified', 'rate_limited', 'http_error']) {
    const item = row(0, { 2: 'ply', 3: 'model.ply', 6: null,
      7: { ...parent.verification, statusLabel: 'Format headers checked', delivery, viewerUrl: parent.viewerUrl } });
    const model = render.individualEntry(item, source, parent);
    assert.equal(model.viewerUrl, undefined, delivery);
    assert.equal(model.candidateViewerUrl, undefined, delivery);
    assert.equal(render.individualSummary(item, source).openUrl, undefined, delivery);
    assert.equal(render.catalogSummary({ ...parent, verification: { ...parent.verification, delivery } }).openUrl, undefined, delivery);
  }
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
  assert.equal(selection.metadataUrl, '/hub/datasets/catalog.json');
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
