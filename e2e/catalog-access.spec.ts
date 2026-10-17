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

test('NGS lists one dataset per named scene with its assets kept inside', async ({ page }) => {
  const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf8')) as { entries: { id: string; sourceId: string }[] };
  const ngs = catalog.entries.find(entry => entry.sourceId === 'hf:OpsiClear/NGS')!.id;
  await page.goto(`/hub/datasets/?dataset=${ngs}`);
  const response = await page.request.get(`/hub/datasets/api/entries?dataset=${ngs}`);
  const data = await response.json() as { unit: string; total: number; entries: { title: string }[] };
  expect(data.unit).toBe('named_scene');
  expect(data.total).toBe(259);
  expect(data.entries.every(entry => !/\.(?:ply|stl|json|npz|npy)$/i.test(entry.title))).toBe(true);
  const card = page.locator('#catalog-results .dataset-card').first();
  await card.getByRole('button', { name: /^Metadata for / }).click();
  await card.getByRole('link', { name: 'Full metadata', exact: true }).click();
  await expect(page.locator('main')).toContainText('Scene assets listed');
  const duplicate = await page.request.get(`/hub/datasets/api/entries?dataset=${ngs}&q=scan_20250410_110806`);
  expect(await duplicate.json()).toMatchObject({ total: 1 });
});

test('ArmGS groups reconstruction variants and labels excluded RGB without losing geometry', async ({ page }) => {
  const source = 'hf-dororo99-ours-waymo-armgs-dc9c063eca1c';
  const response = await page.request.get(`/hub/datasets/api/entries?dataset=${source}`);
  const data = await response.json() as { total: number; entries: { id: string; title: string; statusLabel: string; description: string; licenseCategory: string; hasViewer: boolean; openUrl: string }[] };
  expect(data.total).toBe(11);
  expect(data.entries.every(row => !/\/(known_pose_model|triangulated_model|triangulated_text)$/.test(row.title))).toBe(true);
  expect(data.entries.every(row => row.description.includes('excludes original and resized Waymo RGB'))).toBe(true);
  expect(data.entries.every(row => row.licenseCategory === 'non-commercial')).toBe(true);
  const checked = data.entries.find(row => row.title.endsWith('9747453753779078631_940_000_960_000'))!;
  expect(checked.statusLabel).toBe('Model checked; RGB not included');
  expect(checked.hasViewer).toBe(true);
  const open = await page.request.get(checked.openUrl, { maxRedirects: 0 });
  expect(open.status()).toBe(302);
  expect(new URL(open.headers().location).searchParams.get('url')).toMatch(/\/triangulated_model$/);
  await page.goto(`/hub/datasets/entry/${checked.id}`);
  await expect(page.locator('main')).toContainText('Source RGB');
  await expect(page.locator('main')).toContainText('known_pose_model/cameras.txt');
  const centered = data.entries.find(row => row.title.endsWith('10448102132863604198_472_000_492_000'))!;
  await page.goto(`/hub/datasets/entry/${centered.id}`);
  await expect(page.locator('main')).toContainText('colmap_castrack_centered/10448102132863604198_472_000_492_000');
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
