import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const id = (source: string, kind: string, path: string, archive = '') =>
  'data-' + createHash('sha256').update([source, kind, archive, path].join('\0')).digest('hex').slice(0, 24);
const gatedSource = 'hf-akashskypatel-neurcross-labels-69b128482886';
const gatedPath = 'generated-labels/kaggle-balraj98-modelnet40-princeton-3d-object-dataset/airplane_0048-a83c7315ee13/input/airplane_0048-0138384160df.ply';
const gatedId = id('hf:akashskypatel/NeurCross-Labels', 'ply', gatedPath);

test('the reported gated PLY is no longer published', async ({ page }) => {
  const providerRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).hostname === 'huggingface.co') providerRequests.push(request.url()); });
  await page.setViewportSize({ width: 360, height: 900 });
  expect((await page.goto(`/hub/datasets/entry/${gatedId}`))!.status()).toBe(404);
  await expect(page.locator('main')).toContainText('Dataset entry not found.');
  await expect(page.locator('main')).not.toContainText(gatedPath);
  await expect(page.getByRole('link', { name: /Try in ColmapView|Try listed model|Dataset URL/ })).toHaveCount(0);
  expect(providerRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('removed gated collections have no page, search result or dataset option', async ({ page }) => {
  expect((await page.goto(`/hub/datasets/${gatedSource}`))!.status()).toBe(404);
  await page.goto(`/hub/datasets/?dataset=${gatedSource}`);
  await expect(page.locator('#catalog-count')).toHaveText('No matching datasets');
  await expect(page.locator(`option[value="${gatedSource}"]`)).toHaveCount(0);
  const response = await page.request.get(`/hub/datasets/api/entries?dataset=${gatedSource}`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ total: 0, entries: [], dataset: null });
  expect((await page.request.get(`/hub/datasets/individual/sources/${gatedSource}.json`)).status()).toBe(404);
});

test('extraction-only collections are removed from pages and public metadata', async ({ page }) => {
  const source = 'hf-imchuling-3d-room-collections-bcd1917cdfaa';
  expect((await page.goto(`/hub/datasets/${source}`))!.status()).toBe(404);
  expect((await page.request.get(`/hub/datasets/individual/sources/${source}.json`)).status()).toBe(404);
  const response = await page.request.get(`/hub/datasets/api/entries?dataset=${source}`);
  expect(await response.json()).toMatchObject({ total: 0, entries: [], dataset: null });
});

test('standalone extracted members and their nonopening collections are absent', async ({ page }) => {
  const member = id('hf:paroj/ycbev', 'ply', 'models_eval/obj_000001.ply', 'ycbv_models.zip');
  expect((await page.goto(`/hub/datasets/entry/${member}`))!.status()).toBe(404);
  expect((await page.goto('/hub/datasets/hf-paroj-ycbev-sd-c89da44da829'))!.status()).toBe(404);
});

test('a checked standalone file does not keep a collection without loadable named scenes published', async ({ page }) => {
  const audit = JSON.parse(readFileSync('data/dataset-audit.json', 'utf8')) as { results: { sourceId: string; loadUrl?: string; gated?: boolean | string; viewerImport?: { status: string } }[] };
  const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf8')) as { entries: { id: string; sourceId: string }[] };
  const published = JSON.parse(readFileSync('public/hub/datasets/catalog.json', 'utf8')) as typeof catalog;
  const retained = new Set(published.entries.map(entry => entry.sourceId));
  const sample = audit.results.find(row => row.sourceId.startsWith('hf:') && row.loadUrl?.endsWith('.ply') && !row.gated
    && row.viewerImport?.status === 'passed' && !retained.has(row.sourceId) && catalog.entries.some(entry => entry.sourceId === row.sourceId));
  expect(sample).toBeTruthy();
  const collection = catalog.entries.find(entry => entry.sourceId === sample!.sourceId)!;
  expect((await page.goto(`/hub/datasets/${collection.id}`))!.status()).toBe(404);
  expect((await page.request.get(`/hub/datasets/individual/sources/${collection.id}.json`)).status()).toBe(404);
});

test('reviewed missing models and unsupported spherical cameras have no public scenes or collection pages', async ({ page }) => {
  for (const source of ['hf-perry233-astrovision-data-a1cdfc4cd9d3', 'hf-siminkou-dyomni-9f8f10c760ba']) {
    expect((await page.goto(`/hub/datasets/${source}`))!.status()).toBe(404);
    const response = await page.request.get(`/hub/datasets/api/entries?dataset=${source}`);
    expect(await response.json()).toMatchObject({ total: 0, entries: [], dataset: null });
    expect((await page.request.get(`/hub/datasets/individual/sources/${source}.json`)).status()).toBe(404);
  }
  const removed = id('hf:SiminKou/DyOmni', 'colmap', 'Ayutthaya/output_dir/colmap');
  expect((await page.goto(`/hub/datasets/entry/${removed}`))!.status()).toBe(404);
  expect((await page.request.get(`/hub/datasets/open/${removed}`, { maxRedirects: 0 })).status()).toBe(404);
});

test('Hourglass and other standalone file names are absent from scene browsing', async ({ page }) => {
  const hourglass = id('hf:adfa5456/FastRobustICP', 'stl', 'data/Hourglass.stl');
  expect((await page.goto(`/hub/datasets/entry/${hourglass}`))!.status()).toBe(404);
  await page.goto('/hub/datasets/?q=Hourglass');
  await expect(page.locator('#catalog-count')).toHaveText('No matching datasets');
  const response = await page.request.get('/hub/datasets/api/entries?q=Hourglass');
  expect(await response.json()).toMatchObject({ unit: 'named_scene', total: 0, entries: [] });
});

test('unverified native collections and model-only scenes are excluded', async ({ page }) => {
  for (const source of ['hf-opsiclear-ngs-19c25258f77b', 'hf-dororo99-ours-waymo-armgs-dc9c063eca1c',
    'public-megascenes-000000-arc-de-bera-component-0-native-complete-99744eaac47a']) {
    expect((await page.request.get(`/hub/datasets/${source}`)).status()).toBe(404);
    expect((await page.request.get(`/hub/datasets/individual/sources/${source}.json`)).status()).toBe(404);
    const response = await page.request.get(`/hub/datasets/api/entries?dataset=${source}`);
    expect(await response.json()).toMatchObject({ total: 0, entries: [], dataset: null });
  }
  const maskOnly = id('hf:Dororo99/Ours_Waymo_ArmGS', 'colmap',
    'preprocessing/waymo_prepared/colmap/9747453753779078631_940_000_960_000/triangulated_model');
  expect((await page.request.get(`/hub/datasets/entry/${maskOnly}`)).status()).toBe(404);
  expect((await page.request.get(`/hub/datasets/open/${maskOnly}`, { maxRedirects: 0 })).status()).toBe(404);
});

test('every published scene has exact complete camera-and-photo evidence and the checked launch', async ({ page }) => {
  const policy = JSON.parse(readFileSync('data/verified-scenes.json', 'utf8')) as {
    scenes: { sourceId: string; kind: string; path: string; viewerUrl: string; counts: { images: number } }[] };
  const indexResponse = await page.request.get('/hub/datasets/individual/index.json');
  const index = await indexResponse.json() as { total: number; generation: string };
  const checks = await page.request.get('/hub/datasets/individual/verified-scenes.json');
  expect(await checks.json()).toMatchObject({ generation: index.generation, scenes: policy.scenes });
  const response = await page.request.get('/hub/datasets/api/entries?viewer=available');
  const data = await response.json() as { total: number; entries: { id: string; statusLabel: string; delivery: string; hasViewer: boolean }[] };
  expect(index.total).toBe(3);
  expect(data.total).toBe(policy.scenes.length);
  expect(data.entries.every(scene => scene.hasViewer && scene.statusLabel === 'Cameras + photos verified' && scene.delivery === 'browser_readable')).toBe(true);
  for (const scene of policy.scenes) {
    const sceneId = id(scene.sourceId, scene.kind, scene.path);
    expect(data.entries.some(row => row.id === sceneId)).toBe(true);
    const open = await page.request.get(`/hub/datasets/open/${sceneId}`, { maxRedirects: 0 });
    expect(open.status()).toBe(302);
    expect(open.headers().location).toBe(scene.viewerUrl);
    await page.goto(`/hub/datasets/entry/${sceneId}`);
    await expect(page.getByRole('link', { name: 'Try in ColmapView' })).toHaveAttribute('href', scene.viewerUrl);
    await expect(page.locator('main')).toContainText('Verified original photographs');
    await expect(page.locator('main')).toContainText(`${scene.counts.images} posed original photographs`);
  }
  const catalogResponse = await page.request.get('/hub/datasets/catalog.json');
  const catalog = await catalogResponse.json() as { entries: { id: string; viewerUrl?: string; dataUrl: string; sourceUrl: string }[] };
  expect(catalog.entries).toHaveLength(3);
  for (const source of catalog.entries) {
    expect(source.viewerUrl).toBeUndefined();
    expect(source.dataUrl).toBe(source.sourceUrl);
    await page.goto(`/hub/datasets/${source.id}`);
    await expect(page.getByRole('link', { name: 'Try in ColmapView' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Browse this dataset’s named scenes' })).toBeVisible();
  }
});

test('a checked companion PLY cannot qualify a scene or collection for publication', async ({ page }) => {
  for (const sample of [
    { source: 'hf:Dororo99/Ours_Waymo_ADGS', collection: 'hf-dororo99-ours-waymo-adgs-b00d3434f2f7', path: '9747453753779078631_940_000_960_000' },
    { source: 'hf:HaoqinHong/Physics-Informed-Deformable-Gaussian-Splatting', collection: 'hf-haoqinhong-physics-informed-deformable-gaussian-splatting-18cc223a260c', path: 'dry_ice' },
  ]) {
    const response = await page.request.get(`/hub/datasets/api/entries?dataset=${sample.collection}`);
    expect(await response.json()).toMatchObject({ total: 0, entries: [], dataset: null });
    const entry = id(sample.source, 'camera-scene', sample.path);
    expect((await page.goto(`/hub/datasets/entry/${entry}`))!.status()).toBe(404);
    expect((await page.request.get(`/hub/datasets/open/${entry}`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await page.request.get(`/hub/datasets/${sample.collection}`)).status()).toBe(404);
    expect((await page.request.get(`/hub/datasets/individual/sources/${sample.collection}.json`)).status()).toBe(404);
  }
});
