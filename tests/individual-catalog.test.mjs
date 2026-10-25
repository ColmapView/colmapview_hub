import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { catalogRenderer } from '../scripts/build/renderer.mjs';
import { applyIndividualListings } from '../scripts/catalog/individual-listings.mjs';
import { applyDatasetLabels } from '../scripts/catalog/dataset-labels.mjs';

const render = await catalogRenderer();
const verified = JSON.parse(readFileSync('tests/fixtures/verified-scene-proof.json', 'utf8'));

test('inconsistent native feature links stay visible on cards and details while preserving direct viewing', () => {
  const note = 'Source track targets name different points. Only bounded samples were checked.';
  const proof = { ...nativePhotoProof('sample_checked'), statusLabel: 'Feature links need review', summary: note,
    sourceIntegrityReview: { status: 'inconsistent', scope: 'sampled_relationships', checkedAt: '2026-10-22', summary: note,
      receiptSha256: 'a'.repeat(64), files: Object.fromEntries(['images', 'points3d'].map(role => [role,
        { path: `${role}.bin`, sha256: 'b'.repeat(64), bytes: 1024, scope: 'prefix' }])) } };
  const record = row(0, { 7: proof });
  assert.equal(render.canOpenIndividual(record, source), true);
  assert.match(render.catalogCard(render.individualSummary(record, source)), /Feature links need review/);
  const entry = render.individualEntry(record, source, parent);
  assert.equal(entry.viewerUrl, proof.viewerUrl);
  assert.match(render.catalogEntryPage(entry), /Source feature links/);
  assert.ok(entry.facts.some(fact => fact.label === 'Relationship check scope' && /Bounded.*unverified/.test(fact.value)));
  proof.sourceIntegrityReview.scope = 'complete_model';
  assert.ok(render.individualEntry(record, source, parent).facts.some(fact => fact.label === 'Relationship check scope' && fact.value === 'Complete original model'));
});

test('calibration and resolution reviews stay visible without replacing verified model actions', () => {
  const note = 'Source focal ratio is unverified; original calibration is preserved.';
  const proof = { ...nativePhotoProof('sample_checked'), statusLabel: 'Calibration needs review', summary: note,
    calibrationReview: { status: 'unverified', checkedAt: '2026-10-22', cameraFileSha256: 'c'.repeat(64), summary: note },
    photoAudit: { status: 'sample_checked', checkedAt: '2026-10-22', listingComplete: true, policy: 'native_scene',
      summary: 'Resolution mapping remains unverified.', sceneRoot: 'scene', policyNote: '', samplePath: 'scene/a.png',
      sampleBrowserRead: true, samplePixels: 'decoded', sampleWidth: 640, sampleHeight: 480, sampleDimensionsMatch: false,
      sampleCalibration: { width: 1280, height: 960, sha256: 'c'.repeat(64) } } };
  const record = row(0, { 7: proof });
  assert.equal(render.canOpenIndividual(record, source), true);
  const summary = render.individualSummary(record, source);
  assert.match(render.catalogCard(summary), /Calibration needs review/);
  const entry = render.individualEntry(record, source, parent);
  assert.equal(entry.viewerUrl, proof.viewerUrl);
  assert.ok(entry.facts.some(fact => fact.label === 'Photo / camera resolution' && fact.value === '640 × 480 / 1280 × 960 pixels'));
  const html = render.catalogEntryPage(entry);
  assert.match(html, /Calibration review/);
  assert.match(html, /image-to-camera resolution mapping remains unverified/);
  assert.doesNotMatch(html, /All registered originals checked/);
});

test('seeded discovery is a stable, complete permutation and pagination does not repeat scenes', () => {
  const sources = Array.from({ length: 32 }, (_, i) => ({ id: `source-${i}`, provider: 'huggingface', start: i ? 300 + (i - 1) * 5 : 0, count: i ? 5 : 300 }));
  const asset = { schemaVersion: 1, generation: 'catalog', rows: Array.from({ length: 455 }, () => [1, 0, 20000]) };
  const candidates = asset.rows.map((_, i) => i);
  for (const mode of ['discover', 'random', 'new']) {
    const options = { mode, seed: '12345678' };
    const all = render.discoveryOrder(asset, sources, candidates, options);
    assert.equal(all.length, candidates.length);
    assert.equal(new Set(all).size, all.length);
    assert.deepEqual(render.discoveryOrder(asset, sources, candidates, options, 48), all.slice(0, 48));
    assert.notDeepEqual(render.discoveryOrder(asset, sources, candidates, { ...options, seed: '87654321' }, 24), all.slice(0, 24));
    const groups = all.slice(0, 20).map(i => i < 300 ? 0 : 1 + Math.floor((i - 300) / 5));
    assert.ok(new Set(groups).size >= 10, `${mode} should balance a dominant collection`);
    assert.ok(groups.every((group, i) => !i || group !== groups[i - 1]), `${mode} should separate collections`);
  }
});

test('new scenes stay chronological, unknown dates stay last, and one-collection filters fully exhaust', () => {
  const sources = [{ id: 'a', provider: 'huggingface', start: 0, count: 4 }, { id: 'b', provider: 'huggingface', start: 4, count: 2 }];
  const asset = { generation: 'catalog', rows: [[1, 0, 20], [1, 0, 20], [1, 0, 20], [3, 1, 0], [3, 1, 10], [3, 1, 0]] };
  const ordered = render.discoveryOrder(asset, sources, [0, 1, 2, 3, 4, 5], { mode: 'new', seed: '12345678' });
  assert.deepEqual(ordered.map(i => asset.rows[i][2]), [20, 20, 20, 10, 0, 0]);
  for (const mode of ['discover', 'random', 'new']) {
    const only = render.discoveryOrder(asset, sources.slice(0, 1), [0, 1, 2, 3], { mode, seed: '12345678' });
    assert.deepEqual([...only].sort(), [0, 1, 2, 3]);
  }
});

test('discovery assets and feed inputs reject stale generations, bad tiers and unbounded seeds', () => {
  const index = { total: 1, generation: 'current' };
  const asset = { schemaVersion: 1, generation: 'current', rows: [[3, 0, 20000]] };
  assert.equal(render.isDiscoveryAsset(asset, index), true);
  for (const bad of [{ ...asset, generation: 'old' }, { ...asset, rows: [] }, { ...asset, rows: [[4, 0, 1]] },
    { ...asset, rows: [[3, 2, 1]] }, { ...asset, rows: [[3, 0, -1]] }]) assert.equal(render.isDiscoveryAsset(bad, index), false);
  for (const query of ['sort=trending', 'sort=constructor', 'seed=../../secret', 'seed=abc', `seed=${'a'.repeat(33)}`]) {
    assert.throws(() => render.individualFilters(new URLSearchParams(query)), /Invalid/);
  }
});

test('discovery search applies filters before ranking and keeps camera-only scenes eligible', async () => {
  const sources = [{ ...source, count: 48 }, { ...source, id: 'hf-other-123456abcdef', label: 'Other', start: 48, count: 6 }];
  const rows = Array.from({ length: 54 }, (_, i) => row(i, { 1: i < 48 ? 0 : 1, 2: 'cameras',
    7: { ...nativePhotoProof('not_included'), sceneCompatibility: { ...nativePhotoProof('not_included').sceneCompatibility, points: 0 } } }));
  const index = { schemaVersion: 1, generation: 'feed-fixture', total: rows.length, packSize: 24, sources,
    discovery: { schemaVersion: 1, file: 'feed.json' }, facets: { data: { cameras: { file: 'a'.repeat(16) } } } };
  const asset = { schemaVersion: 1, generation: index.generation, rows: rows.map(() => [2, 0, 20000]) };
  const keys = [];
  const binding = { fetch: async request => {
    const key = new URL(request.url).pathname.split('/individual/')[1]; keys.push(key);
    if (key === 'feed.json') return Response.json(asset);
    if (key.startsWith('facets/')) return Response.json({ postings: Buffer.from([48, 1, 1, 1, 1, 1]).toString('base64') });
    const pack = Number(key.match(/^packs\/(\d+)\.json$/)?.[1]);
    return Number.isInteger(pack) ? Response.json(rows.slice(pack * 24, (pack + 1) * 24)) : new Response(null, { status: 404 });
  } };
  const filters = render.individualFilters(new URLSearchParams('sort=random&seed=12345678'));
  const first = await render.searchIndividuals(binding, 'https://example.org', index, filters);
  filters.set('page', '2');
  const next = await render.searchIndividuals(binding, 'https://example.org', index, filters);
  assert.equal(first.total, 54);
  assert.equal(new Set([...first.entries, ...next.entries].map(entry => entry.id)).size, 48);
  assert.ok(first.entries.every(entry => entry.hasViewer && entry.sceneStats.points === 0));
  const filtered = await render.searchIndividuals(binding, 'https://example.org', index, new URLSearchParams('data=cameras&sort=random&seed=12345678'));
  assert.equal(filtered.total, 6);
  assert.ok(filtered.entries.every(entry => entry.dataset.id === sources[1].id));
  assert.ok(keys.every(key => !key.startsWith('sources/')));
  asset.generation = 'stale';
  await assert.rejects(render.searchIndividuals(binding, 'https://example.org', index, filters), /does not match/);
  asset.generation = index.generation;
  rows.forEach(row => { row[7].opening = { status: 'load_failed' }; });
  await assert.rejects(render.searchIndividuals(binding, 'https://example.org', index, filters), /no longer qualifies/);
});

test('companion archive manifests preserve native gates and keep sample evidence separate from exports', () => {
  const proof = nativePhotoProof('companion_archive');
  const sha256 = 'c'.repeat(64), url = `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${sha256}.manifest.json`;
  proof.viewerUrl = `https://colmapview.opsiclear.com/?url=${encodeURIComponent(url)}`;
  proof.photoArchiveRouting = { sha256, url, archivePath: 'scene/images.zip', bytes: 8192, format: 'zip', photoLowerBound: 10,
    sampleRegisteredName: 'a.png', sampleMemberPath: 'a.png', checkedAt: '2026-10-19', viewerVersion: '0.19.2', viewerCommit: 'b'.repeat(40) };
  const record = row(0, { 7: proof });
  assert.equal(render.canOpenIndividual(record, source), true);
  const entry = render.individualEntry(record, source, parent);
  const html = render.catalogEntryPage(entry);
  assert.match(html, /at least 10 photographs/);
  assert.doesNotMatch(html, /COLMAP \+ images export SHA-256/);
  const selected = { ...proof, photoArchiveRouting: { ...proof.photoArchiveRouting, archivePath: 'scene/images.tar',
    format: 'tar', indexBytes: 4096, viewerVersion: '0.20.5' } };
  assert.equal(render.canOpenIndividual(row(0, { 7: selected }), source), true);
  for (const changes of [{ indexBytes: 513 }, { indexBytes: 8704 }, { format: 'zip', archivePath: 'scene/images.zip' },
    { viewerVersion: '0.20.4' }, { viewerVersion: 'bad' }]) {
    assert.equal(render.canOpenIndividual(row(0, { 7: { ...selected,
      photoArchiveRouting: { ...selected.photoArchiveRouting, ...changes } } }), source), false);
  }
  for (const mutated of [{ ...proof, viewerUrl: 'https://example.com/' }, { ...proof, photoAvailability: 'sample_checked' },
    { ...proof, sceneValidation: verified.sceneValidation },
    { ...proof, photoArchiveRouting: { ...proof.photoArchiveRouting, viewerVersion: '0.19.1' } }]) {
    assert.equal(render.canOpenIndividual(row(0, { 7: mutated }), source), false);
  }
});

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

test('model-only export details retain camera statistics and do not claim original-photo export', () => {
  const proof = { ...parent.verification, ...verified, statusLabel: 'Camera model export checked', photoAvailability: 'not_checked', checkedAt: '2026-10-19',
    summary: 'Cameras passed an independent model export check.', scope: 'The selected camera model only.',
    sceneValidation: { ...verified.sceneValidation, export: 'colmap_model', photoCount: 0 } };
  const item = row(0, { 2: 'camera-scene', 7: proof });
  assert.equal(render.canOpenIndividual(item, source), true);
  const summary = render.individualSummary(item, source);
  assert.equal(summary.sceneStats.cameraPoses, proof.sceneValidation.images);
  assert.equal(summary.sourceUrl, parent.sourceUrl);
  assert.ok(render.catalogCard(summary).includes(`href="${parent.sourceUrl}" target="_blank" rel="noopener noreferrer">Original source`));
  const entry = render.individualEntry(item, source, parent);
  const html = render.catalogEntryPage(entry);
  assert.match(html, /COLMAP model export SHA-256/);
  assert.doesNotMatch(html, /Verified original photographs|COLMAP \+ images export SHA-256/);
});

test('camera metadata with a verified XYZ companion shows the loaded count and exact source', () => {
  const pointPath = 'scene/points_gt.ply';
  const proof = { ...verified, companionPointCloud: pointPath,
    sceneValidation: { ...verified.sceneValidation, export: 'colmap_model', photoCount: 0, points: 100000 } };
  const item = row(0, { 2: 'camera-scene', 6: { ['asset:' + pointPath]: pointPath }, 7: proof });
  assert.equal(render.individualSummary(item, source).sceneStats.points, 100000);
  const entry = render.individualEntry(item, source, parent);
  assert.ok(entry.facts.some(fact => fact.label === 'Imported XYZ point cloud (no feature tracks)' && fact.value === pointPath && fact.url));
  assert.ok(entry.facts.some(fact => fact.label === 'Verified point source' && fact.value === pointPath));
});

test('photo availability is displayed separately without changing model actions', () => {
  for (const [status, label] of [['partial', 'Images partially available'], ['path_policy_required', 'Photos need setup'],
    ['companion_archive', 'Photos in a separate archive'], ['not_found', 'No loose photos found'], ['not_included', 'Photos not included']]) {
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

function routedPhotoProof() {
  const proof = nativePhotoProof('sample_checked');
  const sha256 = 'a'.repeat(64);
  const photoRouting = { url: `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${sha256}.manifest.json`, sha256,
    listedPhotos: 10, mappedNames: 1, nameCheck: { inspected: 1, matched: 1, ambiguous: 0, registered: proof.sceneCompatibility.images, complete: false },
    checkedAt: '2026-10-19', viewerVersion: '0.17.7', viewerCommit: 'b'.repeat(40) };
  return { ...proof, photoRouting, viewerUrl: 'https://colmapview.opsiclear.com/?url=' + encodeURIComponent(photoRouting.url) };
}

test('photo routing manifests retain native statistics and independent export qualification', () => {
  const proof = routedPhotoProof(), record = row(0, { 7: proof });
  assert.equal(render.canOpenIndividual(record, source), true);
  const summary = render.individualSummary(record, source);
  assert.equal(summary.sceneStats.cameraPoses, proof.sceneCompatibility.images);
  assert.equal(summary.sceneStats.points, proof.sceneCompatibility.points);
  const html = render.catalogEntryPage(render.individualEntry(record, source, parent));
  assert.match(html, /Photo path manifest/);
  assert.match(html, /1\/1 inspected registered names/);
  assert.doesNotMatch(html, /Selected scene export SHA-256/);
});

test('photo manifests cannot inherit a different URL, registered count or full-export evidence', () => {
  for (const change of [proof => { proof.viewerUrl += '&other=1'; },
    proof => { proof.photoRouting.url = 'https://other.test/manifest.json'; },
    proof => { proof.photoRouting.nameCheck.registered++; },
    proof => { proof.photoRouting.nameCheck.complete = true; },
    proof => { proof.photoRouting.mappedNames = 0; },
    proof => { proof.photoRouting.nameCheck.ambiguous = 1; },
    proof => { proof.sceneValidation = verified.sceneValidation; }]) {
    const proof = routedPhotoProof(); change(proof);
    assert.equal(render.canOpenIndividual(row(0, { 7: proof }), source), false);
  }
});

test('sampled TAR photos and compressed splats retain their loading requirements', () => {
  const proof = nativePhotoProof('companion_archive');
  proof.photoAudit = { status: 'companion_archive', checkedAt: '2026-10-19', listingComplete: true,
    policy: 'capture_prefix', sceneRoot: 'ground_truths/capture', summary: 'A matching TAR photograph was sampled.',
    policyNote: 'Extract photos separately.', archive: { path: 'images/capture.tar', format: 'tar', photos: 2,
      inventoryComplete: false, bytes: 4096, nameSampleMatched: true, browserRangeRead: true,
      sample: { path: 'capture/photo.jpg', registeredName: 'photo.jpg', headerOffset: 512, dataOffset: 1024,
        bytes: 1234, sha256: 'a'.repeat(64), pixels: 'decoded', dimensionsMatch: false } } };
  proof.availableData = { cameras: { status: 'checked' }, images: { status: 'archive' },
    splats: { status: 'needs_setup', samplePath: 'capture/gsplat.ply', encoding: 'compressed_ply', requiresConversion: true } };
  const item = row(0, { 7: proof });
  const summary = render.individualSummary(item, source);
  assert.equal(render.isCatalogSummary(summary), true);
  assert.equal(summary.hasViewer, true);
  const entry = render.individualEntry(item, source, parent);
  assert.equal(entry.viewerUrl, proof.viewerUrl);
  const html = render.catalogEntryPage(entry);
  assert.match(html, /Photos in a separate archive/);
  assert.match(html, /At least 2 image members listed/);
  assert.match(html, /capture\/photo\.jpg → photo\.jpg/);
  assert.match(html, /camera dimensions differ/);
  assert.match(html, /Convert it to standard Gaussian PLY/);
  assert.doesNotMatch(html, /first registered name matched|separate ZIP/);
  assert.equal(render.isCatalogSummary({ ...summary, availableData: { splats: { ...proof.availableData.splats, status: 'checked' } } }), false);
});

test('a bounded pose prefix is displayed separately from complete name coverage', () => {
  const proof = nativePhotoProof('partial');
  proof.photoAudit = { status: 'partial', checkedAt: '2026-10-19', listingComplete: true,
    policy: 'exact_registered_sample', sceneRoot: 'scene', policyNote: 'Later photos exist.', summary: 'A later photo matched.',
    nameCheck: { registered: 74, matched: 1, missing: 73, ambiguous: 0, scope: 'prefix', totalRegistered: 5493 } };
  const html = render.catalogEntryPage(render.individualEntry(row(0, { 7: proof }), source, parent));
  assert.match(html, /Sampled image names matched/);
  assert.match(html, /1\/74 inspected names from 5493 registered poses/);
  assert.match(html, /does not establish complete coverage/);
  assert.doesNotMatch(html, /1\/5493 through the current loader/);
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
  const visible = html.split('<dialog class="dataset-metadata"')[0];
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

test('a shared native model retains its source identities without reviving an older photo-only route', () => {
  const proof = explicitManifestProof();
  proof.sceneManifest.pointFormat = 'colmap_binary';
  proof.sceneManifest.pointSource = 'scene/sparse_native/points3D.bin';
  proof.sceneManifest.pointAssociation = { sceneRoot: 'scene', method: 'identical_native_model' };
  proof.priorPhotoRouting = routedPhotoProof().photoRouting;
  const item = row(0, { 7: proof });
  assert.equal(render.canOpenIndividual(item, source), true);
  assert.equal(render.individualSummary(item, source).sceneStats.points, 350710);
  for (const edit of [p => { p.sceneManifest.pointAssociation.sceneRoot = 'other'; },
    p => { p.sceneManifest.pointAssociation.sceneRoot = '../scene'; },
    p => { p.sceneManifest.pointAssociation.method = 'same_names'; },
    p => { delete p.sceneManifest.pointAssociation; },
    p => { p.sceneCompatibility.points = 1; },
    p => { p.photoRouting = p.priorPhotoRouting; }]) {
    const bad = structuredClone(proof); edit(bad);
    assert.equal(render.canOpenIndividual(row(0, { 7: bad }), source), false);
  }
});

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
  const supplementedCamera=row(0,{2:'cameras',7:proof});
  assert.equal(render.individualSummary(supplementedCamera,source).itemKind,'COLMAP reconstruction');
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

test('temporal scene manifests display only their selected views while retaining original model counts',()=>{
  const proof=explicitManifestProof(),manifest=proof.sceneManifest;
  manifest.sourceCounts={...proof.sceneCompatibility};
  manifest.frameIndices=[1];manifest.counts={cameras:1,images:1,points:42};manifest.photoCount=1;manifest.maskCount=0;
  manifest.pointFormat='numpy_frame';manifest.pointSource='scene/trajectory.npz';
  assert.equal(render.canOpenIndividual(row(0,{7:proof}),source),true);
  assert.deepEqual(render.individualSummary(row(0,{7:proof}),source).sceneStats,{cameraModels:1,cameraPoses:1,points:42});
  for(const indices of [[2],[1,1],[-1],['1'],[]]){
    manifest.frameIndices=indices;
    assert.equal(render.canOpenIndividual(row(0,{7:proof}),source),false);
  }
});

test('public manifest settings assets have their own static CORS rule', () => {
  const headers = readFileSync('public/_headers', 'utf8');
  assert.match(headers, /\/hub\/datasets\/individual\/manifests\/\*\.state\.json\r?\n\s+Access-Control-Allow-Origin: \*/);
  assert.doesNotMatch(headers, /\/hub\/datasets\/individual\/manifests\/\*\r?\n\s+Access-Control-Allow-Origin: \*/);
  assert.match(readFileSync('wrangler.jsonc', 'utf8'), /!\/hub\/datasets\/individual\/\*/);
});

test('selected archive XYZ and Gaussian frames retain truthful counts and fail closed on changed identities', () => {
  for (const role of ['points3D', 'splat']) {
    const proof = explicitManifestProof(), manifest = proof.sceneManifest;
    manifest.viewerVersion = '0.19.10';
    manifest.photoCount = 0; manifest.maskCount = 0;
    manifest.frameGeometry = { sequencePath: 's4/Motion', frame: '0000001', frameCount: 999, role, count: 42,
      sourcePath: role === 'points3D' ? 'pointcloud/s4/Motion.tar.zst' : '3dgs/s4/Motion.zip',
      memberPath: '0000001.ply', memberSha256: 'a'.repeat(64) };
    manifest.pointFormat = role === 'points3D' ? 'archive_xyz_ply' : 'none';
    manifest.pointSource = role === 'points3D' ? manifest.frameGeometry.sourcePath : null;
    manifest.counts.points = role === 'points3D' ? 42 : 0;
    const item = row(0, { 2: 'cameras', 3: 's4/Motion/colmap', 7: proof });
    assert.equal(render.canOpenIndividual(item, source), true);
    const summary = render.individualSummary(item, source);
    assert.equal(summary.sceneStats.points, role === 'points3D' ? 42 : 0);
    assert.equal(summary.itemKind, role === 'points3D' ? 'COLMAP reconstruction' : 'Gaussian scene');
    const entry = render.individualEntry(item, source, parent);
    assert.equal(entry.facts.find(fact => fact.label === 'Selected frame').value, '0000001 from 999 published frames');
    for (const change of [p => { p.sceneManifest.frameGeometry.sourcePath = '3dgs/s5/Other.zip'; },
      p => { p.sceneManifest.frameGeometry.memberPath = '../0000001.ply'; },
      p => { p.sceneManifest.frameGeometry.frameCount = 0; },
      p => { p.sceneManifest.frameGeometry.count = 0; },
      p => { p.sceneManifest.frameGeometry.memberSha256 = ''; },
      p => { p.sceneManifest.frameGeometry.role = 'mesh'; },
      p => { p.sceneManifest.viewerVersion = '0.19.9'; },
      p => { p.sceneManifest.frameIndices = [0, 1]; },
      p => { p.sceneCompatibility.points = 1; }]) {
      const changed = structuredClone(proof); change(changed);
      assert.equal(render.canOpenIndividual(row(0, { 7: changed }), source), false);
    }
    if (role === 'points3D') {
      delete manifest.frameGeometry;
      assert.equal(render.canOpenIndividual(row(0, { 7: proof }), source), false);
    }
  }
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

test('video imagery retains its model receipt, truthful media labels and exact additive launch contract', () => {
  const proof = explicitManifestProof(), model = proof.sceneManifest;
  model.viewerVersion = '0.19.10'; model.photoCount = 0; model.maskCount = 0;
  model.pointFormat = 'archive_xyz_ply'; model.pointSource = 'pointcloud/s6/Motion.tar.zst';
  model.frameGeometry = { sequencePath: 's6/Motion', frame: '0000242', frameCount: 476, role: 'points3D', count: model.counts.points,
    sourcePath: model.pointSource, memberPath: '0000242.ply', memberSha256: 'd'.repeat(64) };
  const digest = 'f'.repeat(64), url = `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${digest}.manifest.json`;
  proof.photoAvailability = 'video_frames'; proof.availableData = { images: { status: 'listed', count: 2, sourceFormat: 'video' } };
  proof.videoFrameRouting = { url, sha256: digest, baseManifestUrl: model.url, baseManifestSha256: model.sha256,
    receiptSha256: 'b'.repeat(64), count: 2, timestamp: 240, frame: '0000242', frameCount: 476,
    checkedAt: '2026-10-23T14:00:00Z', viewerVersion: '0.21.0', viewerCommit: 'c'.repeat(40),
    sample: { name: '0028.png', sourcePath: 's6/Motion/Motion_0028.mp4', sha256: 'a'.repeat(64), width: 800, height: 1280 } };
  proof.viewerUrl = 'https://colmapview.opsiclear.com/?url=' + encodeURIComponent(url);
  const item = row(0, { 7: proof });
  assert.equal(render.canOpenIndividual(item, source), true);
  const summary = render.individualSummary(item, source);
  assert.equal(summary.photoStatus, 'video_frames'); assert.equal(render.isCatalogSummary(summary), true);
  assert.equal(summary.sceneStats.points, model.counts.points);
  const entry = render.individualEntry(item, source, parent), html = render.catalogEntryPage(entry);
  assert.equal(entry.viewerUrl, proof.viewerUrl);
  assert.match(html, /Matched video frames/); assert.match(html, /Images · video frames/);
  assert.match(html, /Synchronized multi-view/);
  assert.equal(summary.videoCapture, 'synchronized_multiview');
  assert.ok(entry.facts.some(fact => fact.label === 'Model-only export SHA-256' && fact.value === model.exportSha256));
  assert.ok(entry.facts.some(fact => fact.label === 'Video frame manifest' && fact.url === url));
  assert.doesNotMatch(html, /All registered originals checked|Video decoding.*outside/);
  for (const edit of [p => { delete p.sceneManifest; }, p => { delete p.videoFrameRouting; },
    p => { p.videoFrameRouting.baseManifestSha256 = 'd'.repeat(64); }, p => { p.videoFrameRouting.count = 3; },
    p => { p.videoFrameRouting.frame = '0000243'; }, p => { p.videoFrameRouting.timestamp = 476; },
    p => { p.videoFrameRouting.viewerVersion = '0.20.6'; }, p => { p.videoFrameRouting.sample.sourcePath = 's6/Other/Other_0028.mp4'; },
    p => { p.viewerUrl = 'https://colmapview.opsiclear.com/?url=' + encodeURIComponent(model.url); }]) {
    const bad = structuredClone(proof); edit(bad);
    assert.equal(render.canOpenIndividual(row(0, { 7: bad }), source), false);
  }
});

const squareThumbnail = { url: '/hub/datasets/individual/thumbnails/' + 'a'.repeat(64) + '.jpg', width: 320, height: 320,
  sourcePath: 'scene/images/a.jpg', sourceSha256: 'b'.repeat(64), datasetLicense: 'cc-by-4.0', license: 'cc-by-sa-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', creditUrl: 'https://commons.wikimedia.org/wiki/File:a.jpg',
  attribution: 'Original photographer', crop: 'center_square' };

test('new full-frame previews retain their aspect ratio and legacy previews stay valid', () => {
  const thumbnail = { ...squareThumbnail, width: 320, height: 234, originalWidth: 4112, originalHeight: 3008, crop: 'aspect_fit' };
  const item = row(0, { 7: { ...nativePhotoProof('sample_checked'), thumbnail } });
  const summary = render.individualSummary(item, source);
  assert.equal(render.isCatalogSummary(summary), true);
  assert.match(render.catalogCard(summary), /width="320" height="234"/);
  assert.match(render.catalogEntryPage(render.individualEntry(item, source, parent)), /Full-frame thumbnail/);
  assert.equal(render.isCatalogSummary({ ...summary, thumbnail: { ...thumbnail, height: 320 } }), false);
});

test('square previews remain same-origin and attributed for every source and image license category', () => {
  const summary = render.individualSummary(row(0, { 7: { ...nativePhotoProof('sample_checked'), thumbnail: squareThumbnail } }), source);
  const html = render.catalogCard(summary);
  assert.equal(render.isCatalogSummary(summary), true);
  assert.match(html, /class="dataset-thumbnail"/);
  assert.match(html, /width="320" height="320" loading="lazy" decoding="async"/);
  assert.match(html, /Original photographer/);
  assert.match(html, /cc-by-sa-4.0/);
  const visible = html.split('<dialog class="dataset-metadata"')[0];
  assert.doesNotMatch(visible, /figcaption|square crop|Original photographer|cc-by-sa-4.0/);
  assert.match(html, /dataset-photo-credit.*Original photographer.*cc-by-sa-4.0.*Cropped/);
  const detail = render.catalogEntryPage(render.individualEntry(row(0, { 7: { ...nativePhotoProof('sample_checked'), thumbnail: squareThumbnail } }), source, parent));
  assert.match(detail, /Center-square crop of a checked registered image/);
  for (const license of ['cc-by-nc-4.0', 'unknown', 'other']) {
    assert.match(render.catalogCard({ ...summary, license, thumbnail: { ...squareThumbnail, datasetLicense: license, license } }), /class="dataset-thumbnail"/);
    assert.match(render.catalogCard({ ...summary, thumbnail: { ...squareThumbnail, license } }), /class="dataset-thumbnail"/);
  }
  // A changed source license still invalidates a stale provenance record.
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
  assert.doesNotMatch(render.catalogCard({ ...licensed, license: 'cc-by-nc-4.0',
    thumbnail: { ...squareThumbnail, datasetLicense: 'cc-by-nc-4.0' } }), /dataset-preview-placeholder/);
});
const parent = { id: 'hf-owner-dataset-123456abcdef', sourceId: 'hf:owner/dataset', title: 'owner/dataset', provider: 'huggingface',
  sourceUrl: 'https://huggingface.co/datasets/owner/dataset', dataUrl: 'https://huggingface.co/datasets/owner/dataset/tree/abc/first/sparse/0',
  viewerUrl: 'https://colmapview.opsiclear.com/?url=sample', license: 'cc-by-4.0', access: 'public', status: 'audited_header_checked',
  statusLabel: 'Sample opened in viewer', formats: ['COLMAP'], description: 'A representative sample opened.', checkedAt: '2026-10-16', testOrFixture: false,
  facts: [{ label: 'Pinned revision', value: 'abc' }], audits: [{ sourceId: 'source-check', checkedAt: '2026-10-16', scope: 'source', facts: [] }],
  verification: { level: 'header_checked', delivery: 'browser_readable', checkedAt: '2026-10-16', summary: 'A representative sample opened.', scope: 'One sample.', viewerVersion: '0.16.14' } };
const source = { id: parent.id, sourceId: parent.sourceId, title: parent.title, label: 'NGS', provider: 'huggingface', license: parent.license,
  sourceUrl: parent.sourceUrl, access: 'public', start: 0, count: 3, listingComplete: false };
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
  assert.match(html, /class="dataset-open" href="\/s\/d\/[A-Za-z0-9_-]{16}"/);
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
    assert.match(render.catalogCard({ ...native, openUrl }), /class="dataset-open" href="\/s\/d\/[A-Za-z0-9_-]{16}"/);
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

test('grouped variants retain exact old selections without changing browse totals', async () => {
  const { index, binding } = fixture();
  index.groupedVariants = 1;
  const id = 'data-' + 'f'.repeat(24);
  const original = row(0, { 0: id, 3: 'scene0000_00/sparse/init', 7: nativePhotoProof('not_included') });
  const assets = { fetch: async request => new URL(request.url).pathname.endsWith('/variants/ff.json')
    ? Response.json({ [id]: original }) : binding.fetch(request) };
  const entry = await render.readIndividual(assets, 'https://colmapview.opsiclear.com', index, id);
  assert.equal(entry.id, id);
  assert.equal(entry.viewerUrl, original[7].viewerUrl);
  assert.ok(entry.sourceId.endsWith(':scene0000_00/sparse/init'));
  const browse = await render.searchIndividuals(assets, 'https://colmapview.opsiclear.com', index, new URLSearchParams());
  assert.equal(browse.total, index.total);
  assert.ok(browse.entries.every(entry => entry.id !== id));
  assert.equal(render.individualSummary(row(0, { 7: { ...original[7], sceneTitle: 'scene0000_00' } }), source).title, 'scene0000_00');
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

test('cached source metadata refreshes inventory facts idempotently and retains media-scan provenance', () => {
  const snapshot = { entries: [structuredClone(parent)] };
  snapshot.entries[0].facts.push(
    { label: 'Complete COLMAP models listed', value: '1' },
    { label: 'Individual listing coverage', value: 'Incomplete source listing' },
    { label: 'Image files listed in repository', value: '100' },
  );
  const registry = { schemaVersion: 1, checkedAt: '2026-10-22', sources: [{ datasetId: parent.id,
    sourceId: parent.sourceId, revision: 'abc', count: 64, looseColmapCount: 64, plyFileCount: 70,
    listingComplete: true, scope: 'Complete pinned model paths; media are separate.' }] };
  applyIndividualListings(snapshot, registry);
  const first = structuredClone(snapshot);
  applyIndividualListings(snapshot, registry);
  assert.deepEqual(snapshot, first);
  const facts = snapshot.entries[0].facts;
  assert.equal(facts.find(fact => fact.label === 'Complete COLMAP models listed').value, '64');
  assert.equal(facts.find(fact => fact.label === 'PLY files listed').value, '70');
  assert.match(facts.find(fact => fact.label === 'Individual listing coverage').value, /Model paths enumerated/);
  assert.equal(facts.find(fact => fact.label === 'Image files listed at source scan').value, '100');
  assert.ok(!facts.some(fact => fact.label === 'Image files listed in repository'));
  assert.equal(new Set(facts.map(fact => fact.label)).size, facts.length);
  assert.equal(snapshot.entries[0].viewerUrl, parent.viewerUrl);
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
