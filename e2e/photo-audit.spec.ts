import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const sceneId = (source: string, path: string) => 'data-' + createHash('sha256').update([source, 'colmap', '', path].join('\0')).digest('hex').slice(0, 24);

test('photo evidence covers every published scene and keeps stronger export checks separate', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json() as {
    total: number; generation: string; photos: Record<string, number> };
  expect(index.total).toBe(5237);
  expect(index.photos).toEqual({ sample_checked: 1210, path_policy_required: 211, review_required: 41, not_found: 3204,
    not_included: 78, companion_archive: 478, partial: 12, complete_export_checked: 3 });
  expect(Object.values(index.photos).reduce((sum, count) => sum + count, 0)).toBe(index.total);
  const available = await (await page.request.get('/hub/datasets/api/entries?photos=available')).json() as {
    total: number; entries: { photoStatus: string }[] };
  expect(available.total).toBe(1225);
  expect(available.entries.every(entry => ['complete_export_checked', 'sample_checked', 'partial'].includes(entry.photoStatus))).toBe(true);
  const audit = await (await page.request.get('/hub/datasets/individual/photo-audit.json')).json();
  expect(audit).toMatchObject({ generation: index.generation, scenes: 5237, collections: 105, photos: index.photos });
  const csv = await page.request.get('/hub/datasets/individual/photo-audit.csv');
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain('mappingFile,companionArchive,samplePhoto');
  expect(await csv.text()).not.toContain('Eiffel_Tower_Scene');
  await page.goto('/hub/datasets/audit');
  await expect(page.getByRole('heading', { name: 'Photograph availability' })).toBeVisible();
  await expect(page.getByRole('link', { name: /photo availability and path policy \(CSV\)/ })).toHaveAttribute('href', '/hub/datasets/individual/photo-audit.csv');
});

test('photo filtering survives Back and Forward and makes no provider requests', async ({ page }) => {
  const providerRequests: string[] = [];
  page.on('request', request => { if (/huggingface\.co|github\.com|amazonaws\.com/.test(request.url())) providerRequests.push(request.url()); });
  await page.goto('/hub/datasets/?photos=not_included');
  await expect(page.locator('#catalog-count')).toContainText('of 78 scene datasets');
  await expect(page.locator('[data-photo-status]').first()).toHaveText('Photos not included');
  await page.getByRole('combobox', { name: 'Photographs', exact: true }).selectOption('not_found');
  await expect(page.locator('#catalog-count')).toContainText('of 3,204 scene datasets');
  await page.goBack();
  await expect(page.locator('#catalog-count')).toContainText('of 78 scene datasets');
  await expect(page.getByRole('combobox', { name: 'Photographs', exact: true })).toHaveValue('not_included');
  await page.goForward();
  await expect(page.locator('#catalog-count')).toContainText('of 3,204 scene datasets');
  await expect(page.getByRole('combobox', { name: 'Photographs', exact: true })).toHaveValue('not_found');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#catalog-count')).toContainText('of 5,237 scene datasets');
  expect(providerRequests).toEqual([]);
});

test('companion ZIP and Waymo JSON mapping requirements are visible without changing the model link', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json() as {
    sources: { id: string; sourceId: string }[] };
  await page.goto('/hub/datasets/?photos=companion_archive');
  await expect(page.locator('#catalog-count')).toContainText('of 478 scene datasets');
  await expect(page.locator('[data-photo-status]').first()).toHaveText('Photos in a separate ZIP');
  const zipped = await (await page.request.get('/hub/datasets/api/entries?photos=companion_archive')).json() as {
    entries: { id: string; openUrl: string; photoStatus: string }[] };
  await page.goto('/hub/datasets/entry/' + zipped.entries[0].id);
  await expect(page.locator('main')).toContainText('Separate image archive');
  await expect(page.locator('main')).toContainText('current model link does not attach that ZIP');
  expect((await page.request.get(zipped.entries[0].openUrl, { maxRedirects: 0 })).status()).toBe(302);
  const waymo = index.sources.find(source => source.sourceId === 'hf:Dororo99/Ours-V2_waymo_ArmGS')!;
  const mapping = await (await page.request.get('/hub/datasets/api/entries?photos=path_policy_required&dataset=' + waymo.id)).json() as {
    total: number; entries: { id: string; openUrl: string; photoStatus: string }[] };
  expect(mapping.total).toBe(10);
  expect(mapping.entries.every(entry => entry.photoStatus === 'path_policy_required')).toBe(true);
  await page.goto('/hub/datasets/entry/' + mapping.entries[0].id);
  await expect(page.locator('main')).toContainText('Image-name mapping');
  await expect(page.locator('main')).toContainText('mapping.json');
  await expect(page.locator('main')).toContainText('Six-digit COLMAP image names map explicitly to eight-digit cache PNG paths');
  expect((await page.request.get(mapping.entries[0].openUrl, { maxRedirects: 0 })).status()).toBe(302);
});

test('confirmed truncated native models are absent from detail, open and search routes', async ({ page }) => {
  for (const path of ['Eiffel_Tower_Scene/sparse/0', 'Eiffel_Tower_Scene/distorted/sparse/0']) {
    const id = sceneId('hf:AmirHossein-razlighi/Confident_Splatting', path);
    expect((await page.request.get('/hub/datasets/entry/' + id)).status()).toBe(404);
    expect((await page.request.get('/hub/datasets/open/' + id, { maxRedirects: 0 })).status()).toBe(404);
  }
  const search = await (await page.request.get('/hub/datasets/api/entries?q=Eiffel%20Tower')).json();
  expect(search).toMatchObject({ total: 0, entries: [] });
});
