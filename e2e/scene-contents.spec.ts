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
  await expect(first.locator('.dataset-open')).toHaveText('scene0024_01 · i2slam_colmap');
  await expect(first.locator('figcaption')).toHaveCount(0);
  await expect(first.locator('.dataset-photo-credit')).not.toBeVisible();
  const textStyle = (selector: string) => first.locator(selector).first().evaluate(element => {
    const style = getComputedStyle(element);
    return [style.fontSize, style.fontWeight, style.color];
  });
  const secondaryStyle = await textStyle('.dataset-label');
  for (const selector of ['[data-asset="cameras"]', '[data-stat="cameraPoses"]', '[data-stat="points"]', '.dataset-statistics-compact dt']) {
    expect(await textStyle(selector)).toEqual(secondaryStyle);
  }
  await first.getByRole('button', { name: /Metadata/ }).click();
  await expect(first.locator('[data-stat="cameraModels"]')).toBeVisible();
  await expect(first.locator('[data-photo-status]')).toBeVisible();
  await expect(first.locator('.dataset-photo-credit')).toBeVisible();
  await expect(first.locator('.dataset-metadata-title')).toHaveText('data/i2slam_colmap/scene0024_01');
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

test('complete text-model counts and manifest photo requirements appear in the reported scene', async ({ page }) => {
  await page.goto('/hub/datasets/entry/data-77e8433b8e133fba6007a66e');
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('737');
  await expect(page.locator('[data-stat="cameraModels"]')).toHaveText('1');
  await expect(page.locator('[data-stat="points"]')).toHaveText('49,379');
  await expect(page.locator('[data-asset="images"]')).toHaveText('Images · setup');
  await expect(page.locator('main')).toContainText('Photo association manifest');
  await expect(page.locator('main')).toContainText('EVSSM-deblurred');
  await expect(page.locator('main')).toContainText('737/737');
  await expect(page.locator('main')).toContainText('current viewer URL does not attach');
  await expect(page.locator('main')).toContainText('Scene statistics check');
  const csv = await page.request.get('/hub/datasets/individual/photo-audit.csv');
  expect(await csv.text()).toContain('data/i2slam_trigsplat_gt/scene0736_00_manifest.json');
});

test('Kicker retains its complete counts and verified sibling photos without claiming complete export', async ({ page }) => {
  await page.goto('/hub/datasets/entry/data-ea3370325634b929035638c5');
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('31');
  await expect(page.locator('[data-stat="cameraModels"]')).toHaveText('1');
  await expect(page.locator('[data-stat="points"]')).toHaveText('15,897');
  await expect(page.locator('[data-asset="images"]')).toHaveText('Images');
  await expect(page.locator('[data-asset="images"]')).toHaveAttribute('data-asset-status', 'checked');
  await expect(page.locator('main')).toContainText('31/31');
  await expect(page.locator('main')).toContainText('kicker/images');
  await expect(page.locator('main')).toContainText('6048 x 4032');
  await expect(page.locator('main')).toContainText('Both the calibration-folder and parent Kicker URLs attach all photographs');
  await expect(page.locator('main')).toContainText('Photograph pixels decoded');
  await expect(page.locator('main')).toContainText('complete image ZIP exceeds the existing 256 MiB package budget');
  await expect(page.locator('main')).not.toContainText('All photos verified in export');
  const open = await page.request.get('/hub/datasets/open/data-ea3370325634b929035638c5', { maxRedirects: 0 });
  expect(open.status()).toBe(302);
  expect(new URL(open.headers().location).searchParams.get('url')).toBe('https://huggingface.co/datasets/alexmkwizu/colmap-testing-dataset/resolve/511152c3b9cd20ecda698e1ed1559c341ee777ab/kicker/dslr_calibration_jpg');
});

test('ZIP photo previews retain image credits and explicit loading requirements', async ({ page }) => {
  await page.goto('/hub/datasets/?photos=companion_archive');
  const first = page.locator('.dataset-card').first();
  await expect(first.locator('[data-asset="images"]')).toHaveText('Images · ZIP');
  await expect(first.locator('.dataset-thumbnail')).toBeVisible();
  await expect(first.locator('figcaption')).toHaveCount(0);
  await first.getByRole('button', { name: /Metadata/ }).click();
  await expect(first.locator('.dataset-photo-credit a').first()).toHaveAttribute('href', /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  await expect(first.locator('.dataset-photo-credit')).toContainText('cc-by-sa-4.0');
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
  const placeholder = first.getByRole('img', { name: /^No photo:/ });
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toHaveText('No photo');
  const bounds = await placeholder.boundingBox();
  expect(Math.abs(bounds!.width - bounds!.height)).toBeLessThan(1);
  await first.getByRole('button', { name: /Metadata/ }).click();
  await expect(first.locator('[data-photo-status]')).toBeVisible();
  await expect(first.locator('[data-photo-status]')).toHaveText('Photos not included');
});
