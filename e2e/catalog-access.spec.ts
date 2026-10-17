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

test('a PLY-only ZIP collection exposes extraction requirements instead of a checked viewer action', async ({ page }) => {
  await page.goto('/hub/datasets/hf-imchuling-3d-room-collections-bcd1917cdfaa');
  await expect(page.locator('.dataset-tags').getByText('Extract archive before loading', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try in ColmapView' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download archive' })).toBeVisible();
  await expect(page.locator('main')).toContainText('cannot open this archive directly');
});

test('standalone extracted members remain collection evidence and do not become scene cards', async ({ page }) => {
  const member = id('hf:paroj/ycbev', 'ply', 'models_eval/obj_000001.ply', 'ycbv_models.zip');
  expect((await page.goto(`/hub/datasets/entry/${member}`))!.status()).toBe(404);
  await page.goto('/hub/datasets/hf-paroj-ycbev-sd-c89da44da829');
  await expect(page.getByRole('link', { name: 'Download archive' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try in ColmapView' })).toHaveCount(0);
});

test('checked standalone samples remain available as collection evidence', async ({ page }) => {
  const audit = JSON.parse(readFileSync('data/dataset-audit.json', 'utf8')) as { results: { sourceId: string; loadUrl?: string; gated?: boolean | string; viewerImport?: { status: string } }[] };
  const sample = audit.results.find(row => row.sourceId.startsWith('hf:') && row.loadUrl?.endsWith('.ply') && !row.gated && row.viewerImport?.status === 'passed');
  expect(sample).toBeTruthy();
  const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf8')) as { entries: { id: string; sourceId: string }[] };
  const collection = catalog.entries.find(entry => entry.sourceId === sample!.sourceId)!;
  await page.goto(`/hub/datasets/${collection.id}`);
  await expect(page.getByRole('link', { name: 'Try in ColmapView', exact: true })).toHaveAttribute('href',
    'https://colmapview.opsiclear.com/?url=' + encodeURIComponent(sample!.loadUrl!));
  await expect(page.getByRole('link', { name: 'Try listed model (unchecked)' })).toHaveCount(0);
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

test('ADGS preserves its exact checked point-cloud companion within the camera scene', async ({ page }) => {
  const response = await page.request.get('/hub/datasets/api/entries?dataset=hf-dororo99-ours-waymo-adgs-b00d3434f2f7&q=9747453753779078631_940_000_960_000');
  const data = await response.json() as { total: number; entries: { id: string; statusLabel: string; openUrl: string; hasViewer: boolean }[] };
  expect(data.total).toBe(1);
  expect(data.entries[0].statusLabel).toBe('Companion asset opened; scene unverified');
  expect(data.entries[0].hasViewer).toBe(true);
  const open = await page.request.get(data.entries[0].openUrl, { maxRedirects: 0 });
  expect(new URL(open.headers().location).searchParams.get('url')).toMatch(/\/9747453753779078631_940_000_960_000\/colmap\.ply$/);
  await page.goto(`/hub/datasets/entry/${data.entries[0].id}`);
  await expect(page.locator('main')).toContainText('Scene cameras, original photos, masks and complete-scene export remain unverified');
});
