import { expect, test } from '@playwright/test';

test('cards show content roles and load licensed square photos from the Hub', async ({ page }) => {
  const providerRequests: string[] = [];
  page.on('request', request => { if (/huggingface\.co|github\.com|amazonaws\.com|wikimedia\.org/.test(request.url())) providerRequests.push(request.url()); });
  await page.goto('/hub/datasets/?licenseCategory=commercial&photos=available');
  const first = page.locator('.dataset-card').first();
  await expect(first.getByRole('list', { name: 'Available data' })).toBeVisible();
  await expect(first.locator('[data-asset="cameras"]')).toBeVisible();
  await expect(first.locator('[data-asset="images"]')).toBeVisible();
  await expect(first.locator('[data-stat="cameraPoses"]')).toHaveText('227');
  await expect(first.locator('[data-stat="cameraModels"]')).toHaveText('1');
  await expect(first.locator('[data-stat="points"]')).toHaveText('23,659');
  await expect(first.locator('[data-stat="cameraPoses"]')).toBeVisible();
  await expect(first.locator('[data-stat="points"]')).toBeVisible();
  await expect(first.locator('[data-stat="cameraModels"]')).not.toBeVisible();
  await expect(first.locator('[data-photo-status]')).not.toBeVisible();
  await expect(first.locator('.dataset-card-footer')).toHaveCount(0);
  const image = first.locator('.dataset-thumbnail');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => [element.complete, element.naturalWidth, element.naturalHeight])).toEqual([true, 320, 320]);
  await expect(image).toHaveAttribute('src', /^\/hub\/datasets\/individual\/thumbnails\/[a-f0-9]{64}\.jpg$/);
  await expect(first.locator('figcaption')).toContainText('square crop');
  await first.getByRole('button', { name: /Metadata/ }).click();
  await expect(first.locator('[data-stat="cameraModels"]')).toBeVisible();
  await expect(first.locator('[data-photo-status]')).toBeVisible();
  await first.getByRole('button', { name: /Metadata/ }).click();
  await expect(first.locator('[data-stat="cameraModels"]')).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await image.boundingBox();
  expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('combobox', { name: 'License category', exact: true }).selectOption('non-commercial');
  await expect(page.locator('.dataset-thumbnail')).toHaveCount(0);
  expect(providerRequests).toEqual([]);
});

test('scene statistics preserve unknown and confirmed zero point counts', async ({ page }) => {
  await page.goto('/hub/datasets/entry/data-3a6fa2f8987b22f3d3d28276');
  for (const field of ['cameraPoses', 'cameraModels', 'points']) {
    await expect(page.locator(`[data-stat="${field}"]`)).toHaveText('Unknown');
  }
  await page.goto('/hub/datasets/entry/data-f85333e7c1adb523358813a8');
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('6');
  await expect(page.locator('[data-stat="cameraModels"]')).toHaveText('6');
  await expect(page.locator('[data-stat="points"]')).toHaveText('0');
});

test('ZIP photo previews retain image credits and explicit loading requirements', async ({ page }) => {
  await page.goto('/hub/datasets/?photos=companion_archive');
  const first = page.locator('.dataset-card').first();
  await expect(first.locator('[data-asset="images"]')).toHaveText('Images · ZIP');
  await expect(first.locator('.dataset-thumbnail')).toBeVisible();
  await expect(first.locator('figcaption a').first()).toHaveAttribute('href', /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  await expect(first.locator('figcaption')).toContainText('cc-by-sa-4.0');
  await first.getByRole('button', { name: /Metadata/ }).click();
  await first.getByRole('link', { name: 'Full metadata', exact: true }).click();
  await expect(page.locator('main')).toContainText('Preview attribution');
  await expect(page.locator('main')).toContainText('current model link does not attach that ZIP');
  await expect(page.getByRole('link', { name: 'Try in ColmapView', exact: true })).toBeVisible();
});

test('model-only ArmGS cards show masks and cameras without claiming photos', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json() as { sources: { id: string; sourceId: string }[] };
  const source = index.sources.find(source => source.sourceId === 'hf:Dororo99/Ours_Waymo_ArmGS')!;
  await page.goto('/hub/datasets/?dataset=' + source.id);
  await expect(page.locator('#catalog-count')).toContainText('of 11 scene datasets');
  const first = page.locator('.dataset-card').first();
  await expect(first.locator('[data-asset="cameras"]')).toBeVisible();
  await expect(first.locator('[data-asset="masks"]')).toBeVisible();
  await expect(first.locator('[data-asset="images"]')).toHaveCount(0);
  await expect(first.locator('.dataset-thumbnail')).toHaveCount(0);
  await first.getByRole('button', { name: /Metadata/ }).click();
  await expect(first.locator('[data-photo-status]')).toBeVisible();
  await expect(first.locator('[data-photo-status]')).toHaveText('Photos not included');
});
