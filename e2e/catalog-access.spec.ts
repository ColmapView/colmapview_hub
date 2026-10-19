import { expect, test } from '@playwright/test';

test('retired collection pages open the current scene browser and retain source identity', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json();
  expect(index.sources.length).toBeGreaterThan(0);
  for (const source of index.sources) {
    const response = await page.request.get(`/hub/datasets/${source.id}`, { maxRedirects: 0 });
    expect(response.status(), source.id).toBe(308);
    const target = new URL(response.headers().location);
    expect(target.pathname).toBe('/hub/datasets/');
    expect(target.searchParams.get('dataset')).toBe(source.id);
  }
  const source = index.sources[0];
  for (const path of ['/hub/datasets/collections', '/hub/datasets/collections.html', '/hub/datasets/collection-page-2',
    '/hub/datasets/page-2.html', `/hub/datasets/${source.id}.html`, `/hub/datasets/${source.id}/`]) {
    const response = await page.request.get(`${path}?licenseCategory=commercial&page=3`, { maxRedirects: 0 });
    expect(response.status(), path).toBe(308);
    const target = new URL(response.headers().location);
    expect(target.searchParams.get('licenseCategory')).toBe('commercial');
    expect(target.searchParams.has('page')).toBe(false);
  }
  await page.goto(`/hub/datasets/${source.id}`);
  await expect(page.getByRole('heading', { name: 'Public datasets', exact: true })).toBeVisible();
  await expect(page.getByLabel('Collection', { exact: true })).toHaveValue(source.id);
  await expect(page.locator('#dataset-selection')).toContainText(source.label);
  await expect(page.locator('a[href*="/datasets/collections"], a[href*="/datasets/collection-page-"]')).toHaveCount(0);
  expect((await page.request.get(`/hub/datasets/individual/sources/${source.id}.json`)).status()).toBe(200);
  expect((await page.request.get('/hub/assets/catalog.js')).status()).toBe(404);
});
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

test('native layouts remain listed with optional or missing photographs', async ({ page }) => {
  for (const [source, count] of [['hf-opsiclear-ngs-19c25258f77b', 259], ['hf-dororo99-ours-waymo-armgs-dc9c063eca1c', 11]] as const) {
    const response = await page.request.get(`/hub/datasets/api/entries?dataset=${source}`);
    const data = await response.json() as { total: number; entries: { id: string; openUrl: string; description: string }[] };
    expect(data.total).toBe(count);
    const target = await page.request.get(data.entries[0].openUrl, { maxRedirects: 0 });
    expect(target.status()).toBe(302);
    expect(new URL(target.headers().location).searchParams.get('url')).not.toMatch(/\.ply$/);
    await page.goto(`/hub/datasets/entry/${data.entries[0].id}`);
    await expect(page.locator('main')).toContainText('Original photographs');
    await expect(page.locator('main')).toContainText('Native layout check');
    if (count === 11) {
      await expect(page.locator('main')).toContainText('Not included by publisher');
      expect(data.entries.every(row => row.description.includes('does not include the original photographs'))).toBe(true);
    }
  }
});

test('complete-export evidence stays scoped while other model layouts remain loadable', async ({ page }) => {
  const policy = JSON.parse(readFileSync('data/verified-scenes.json', 'utf8')) as {
    scenes: { sourceId: string; kind: string; path: string; viewerUrl: string; export?: string; counts: { images: number } }[] };
  const indexResponse = await page.request.get('/hub/datasets/individual/index.json');
  const index = await indexResponse.json() as { total: number; generation: string };
  const checks = await page.request.get('/hub/datasets/individual/verified-scenes.json');
  const published = await checks.json() as { generation: string; scenes: typeof policy.scenes };
  const sortScenes = (scenes: typeof policy.scenes) => scenes.toSorted((a, b) => id(a.sourceId, a.kind, a.path).localeCompare(id(b.sourceId, b.kind, b.path)));
  expect(published.generation).toBe(index.generation);
  expect(sortScenes(published.scenes)).toEqual(sortScenes(policy.scenes));
  const response = await page.request.get('/hub/datasets/api/entries?status=Cameras%20%2B%20photos%20verified');
  const data = await response.json() as { total: number; entries: { id: string; statusLabel: string; delivery: string; hasViewer: boolean }[] };
  expect(index.total).toBe(5576);
  const completePhotoExports = policy.scenes.filter(scene => scene.export !== 'colmap_model');
  expect(completePhotoExports).toHaveLength(3);
  expect(data.total).toBe(completePhotoExports.length);
  expect(data.entries.every(scene => scene.hasViewer && scene.statusLabel === 'Cameras + photos verified' && scene.delivery === 'browser_readable')).toBe(true);
  for (const scene of completePhotoExports) {
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
  expect(catalog.entries.length).toBeGreaterThan(3);
  for (const source of catalog.entries.slice(0, 3)) {
    expect(source.viewerUrl).toBeUndefined();
    expect(source.dataUrl).toBe(source.sourceUrl);
    await page.goto(`/hub/datasets/${source.id}`);
    await expect(page.getByRole('link', { name: 'Try in ColmapView' })).toHaveCount(0);
    await expect(page.getByLabel('Collection', { exact: true })).toHaveValue(source.id);
  }
});

test('a checked companion PLY cannot qualify a scene or collection for publication', async ({ page }) => {
  for (const sample of [
    { source: 'hf:Dororo99/Ours_Waymo_ADGS', collection: 'hf-dororo99-ours-waymo-adgs-b00d3434f2f7', path: '9747453753779078631_940_000_960_000' },
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

test('new camera-only and metadata scenes open their checked model with optional photos, never a companion PLY', async ({ page }) => {
  const policy = JSON.parse(readFileSync('data/verified-scenes.json', 'utf8')) as {
    scenes: { sourceId: string; kind: string; path: string; viewerUrl: string; export?: string }[] };
  const modelExports = policy.scenes.filter(scene => scene.export === 'colmap_model');
  expect(modelExports).toHaveLength(38);
  const result = await (await page.request.get('/hub/datasets/api/entries?status=Camera%20model%20export%20checked')).json();
  expect(result.total).toBe(38);
  expect(result.entries.every((entry: { hasViewer: boolean; photoStatus: string }) => entry.hasViewer && entry.photoStatus !== 'complete_export_checked')).toBe(true);
  const scene = modelExports.find(scene => scene.sourceId === 'hf:HaoqinHong/Physics-Informed-Deformable-Gaussian-Splatting')!;
  const entry = id(scene.sourceId, scene.kind, scene.path);
  const open = await page.request.get(`/hub/datasets/open/${entry}`, { maxRedirects: 0 });
  expect(open.status()).toBe(302);
  expect(open.headers().location).toBe(scene.viewerUrl);
  expect(new URL(scene.viewerUrl).searchParams.get('url')).toMatch(/dry_ice\/transforms.*\.json$/);
  await page.goto(`/hub/datasets/entry/${entry}`);
  await expect(page.locator('main')).toContainText('COLMAP model export SHA-256');
  await expect(page.locator('main')).not.toContainText('Verified original photographs');
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('97');
  await expect(page.locator('[data-stat="points"]')).toHaveText('0');
  const cameraOnly = id('hf:Bugjudger/HDR_Pretrain', 'cameras', 'scenes/102343992/sparse/0');
  const target = await page.request.get(`/hub/datasets/open/${cameraOnly}`, { maxRedirects: 0 });
  expect(target.status()).toBe(302);
  const url = new URL(target.headers().location).searchParams.get('url')!;
  const manifest = await (await page.request.get(url.replace('https://colmapview.opsiclear.com', ''))).json();
  expect(Object.keys(manifest.files).sort()).toEqual(['cameras', 'images']);
  expect(manifest.imagesPath).toContain('/scenes/102343992/images/');
  expect(manifest.baseUrl).toBe('https://colmapview.opsiclear.com/hub/datasets/individual/manifests/');
  await page.goto(`/hub/datasets/entry/${cameraOnly}`);
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('35');
  await expect(page.locator('[data-stat="points"]')).toHaveText('0');
});
