import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { manifestLaunchUrl, manifestPlan, compareManifestCounts, manifestHash, manifestLoadSummary, providerRetryDelay } from '../scripts/audit/manifest-plan.mjs';

test('provider cooldown honors quota reset, Retry-After seconds and dates, with a conservative fallback', () => {
  assert.equal(providerRetryDelay({ RateLimit: '"resolvers";r=0;t=42' }), 42000);
  assert.equal(providerRetryDelay({ 'Retry-After': '90', RateLimit: '"api";r=0;t=12' }), 90000);
  assert.equal(providerRetryDelay({ 'retry-after': 'Thu, 01 Jan 2026 00:02:00 GMT' }, Date.parse('2026-01-01T00:00:00Z')), 120000);
  assert.equal(providerRetryDelay({ RateLimit: '"api";r=0;t=0' }), 1000);
  assert.equal(providerRetryDelay({}), 300000);
});

test('loading coverage counts distinct manifest URLs, latest attempts and the current viewer and generation', () => {
  const manifests = ['a', 'b', 'c'].map(file => ({ file, sha256: 'identical-body', url: `https://example.com/${file}`, entries: [] }));
  const plan = { generation: 'current', manifests };
  const row = (file, status, extra = {}) => ({ manifest: file, sha256: 'identical-body', generation: 'current', viewerCommit: 'viewer',
    status, sourceUrl: `https://example.com/${file}`, actual: { cameras: 1, images: 2, points: 0 }, ...extra });
  assert.deepEqual(manifestLoadSummary(plan, [row('a', 'passed')], 'viewer'),
    { total: 3, statuses: { passed: 1, failed: 0, inconclusive: 0, budget_exceeded: 0 }, untested: 2 });
  const rows = [row('a', 'failed'), row('a', 'passed'), row('b', 'budget_exceeded'),
    row('c', 'passed', { generation: 'old' }), row('c', 'passed', { viewerCommit: 'other-viewer' })];
  assert.deepEqual(manifestLoadSummary(plan, rows, 'viewer'),
    { total: 3, statuses: { passed: 1, failed: 0, inconclusive: 0, budget_exceeded: 1 }, untested: 1 });
});

test('manifest launch extraction decodes the inner URL and rejects unrelated origins', () => {
  const url = `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${'a'.repeat(64)}.manifest.json`;
  assert.equal(manifestLaunchUrl('https://colmapview.opsiclear.com/?url=' + encodeURIComponent(url)), url);
  assert.equal(manifestLaunchUrl('https://colmapview.opsiclear.com/?url=' + encodeURIComponent(url.replace('colmapview.opsiclear.com', 'example.com'))), null);
  assert.equal(manifestLaunchUrl('https://colmapview.opsiclear.com/'), null);
});

test('loaded counts respect zero, unknown counts and every entry sharing a manifest', () => {
  const entries = [{ id: 'empty', expected: { cameras: 1, images: 2, points: 0 } }, { id: 'unknown', expected: { cameras: null, images: null, points: null } }];
  assert.deepEqual(compareManifestCounts({ cameras: 1, images: 2, points: 0 }, entries), []);
  assert.match(compareManifestCounts({ cameras: 1, images: 2, points: 100 }, entries)[0], /points expected 0, loaded 100/);
  entries.push({ id: 'other', expected: { cameras: 2, images: 2, points: 0 } });
  assert.match(compareManifestCounts({ cameras: 1, images: 2, points: 0 }, entries)[0], /other: cameras/);
  assert.match(compareManifestCounts({ cameras: 1, images: 2, points: 0, splats: 100 }, [{ id: 'frame', expected: { points: 0, splats: 101 } }])[0], /splats expected 101, loaded 100/);
});

test('manifest plans include retained assets and variant references and detect missing files and changed evidence', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'colmapview-manifest-plan-'));
  const directory = resolve(root, 'public/hub/datasets/individual');
  const save = async (path, value) => writeFile(resolve(directory, path), JSON.stringify(value));
  try {
    for (const folder of ['packs', 'variants', 'manifests']) await mkdir(resolve(directory, folder), { recursive: true });
    await mkdir(resolve(root, 'data'));
    await writeFile(resolve(root, 'data/scene-manifests.json'), JSON.stringify({ scenes: [{ selectionSha256: 'a'.repeat(64) }, { selectionSha256: 'b'.repeat(64) }] }));
    const body = { version: 1 }, digest = manifestHash(JSON.stringify(body));
    const filename = 'a'.repeat(64) + '.manifest.json'; // Selection digest differs from body digest.
    const url = `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${filename}`;
    const proof = { viewerUrl: 'https://colmapview.opsiclear.com/?url=' + encodeURIComponent(url), sceneManifest: { sha256: digest, counts: { cameras: 1, images: 2, points: 0 } } };
    const row = ['data-one', 0, 'colmap', 'scene/sparse/refined_aligned', 'COLMAP', null, null, proof];
    await save('index.json', { generation: 'test', total: 1, packSize: 24, sources: [{ sourceId: 'hf:owner/repo' }], groupedVariants: 1 });
    await save('packs/0.json', [row]);
    await save('variants/ff.json', { 'data-old': ['data-old', 0, 'colmap', 'scene/sparse/init', 'COLMAP', null, null, proof] });
    await save('manifests/' + filename, body);
    await save('manifests/' + 'b'.repeat(64) + '.manifest.json', body);
    const schemas = { ColmapManifestSchema: { safeParse: () => ({ success: true }) } };
    const plan = await manifestPlan(root, schemas);
    assert.equal(plan.manifests.length, 2);
    assert.equal(plan.manifests[0].addressing, 'selection');
    assert.deepEqual(plan.manifests[0].entries.map(entry => entry.id), ['data-one', 'data-old']);
    assert.deepEqual(plan.manifests[0].errors, []);
    assert.equal(plan.manifests[1].entries.length, 0);
    proof.sceneManifest.sha256 = 'c'.repeat(64);
    await save('packs/0.json', [row]);
    assert.match((await manifestPlan(root, schemas)).manifests[0].errors[0], /checksum/);
    proof.viewerUrl = proof.viewerUrl.replace(filename, 'd'.repeat(64) + '.manifest.json');
    await save('packs/0.json', [row]);
    assert.equal((await manifestPlan(root, schemas)).missing.length, 1);
    await save('manifests/' + 'e'.repeat(64) + '.manifest.json', body);
    assert.match((await manifestPlan(root, schemas)).manifests.at(-1).errors[0], /neither its content digest nor a recorded selection/);
    const videoBody = { version: 4, videoImages: { '0028.png': { timestamp: 240 } } }, videoDigest = manifestHash(JSON.stringify(videoBody));
    const videoFile = videoDigest + '.manifest.json';
    await save('manifests/' + videoFile, videoBody);
    proof.videoFrameRouting = { sha256: videoDigest };
    proof.viewerUrl = 'https://colmapview.opsiclear.com/?url=' + encodeURIComponent(`https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${videoFile}`);
    await save('packs/0.json', [row]);
    const videoPlan = (await manifestPlan(root, schemas)).manifests.find(item => item.file === videoFile);
    assert.deepEqual(videoPlan.errors, []); // The old model-only body checksum must not be applied to the video layer.
    assert.deepEqual(videoPlan.entries[0].expected, proof.sceneManifest.counts);
    proof.videoFrameRouting.sha256 = 'c'.repeat(64);
    await save('packs/0.json', [row]);
    assert.match((await manifestPlan(root, schemas)).manifests.find(item => item.file === videoFile).errors[0], /checksum/);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir(), 'colmapview-manifest-plan-')));
    await rm(root, { recursive: true, force: true });
  }
});
