import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

test('catalog controls stay on one row and responsive filters keep their values', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/hub/datasets/');
  await page.getByLabel('License category', { exact: true }).selectOption('commercial');
  await expect.poll(() => new URL(page.url()).searchParams.get('licenseCategory')).toBe('commercial');
  for (const width of [1440, 960, 360, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const toolbar = (await page.locator('.catalog-toolbar').boundingBox())!;
    expect(toolbar.height).toBeLessThanOrEqual(64);
    const controls = await Promise.all([
      page.getByRole('searchbox', { name: 'Search datasets' }).boundingBox(),
      page.getByRole('button', { name: 'Search', exact: true }).boundingBox(),
      page.locator('.catalog-advanced > summary').boundingBox(),
    ]);
    expect(Math.max(...controls.map(box => box!.y)) - Math.min(...controls.map(box => box!.y))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel('License category', { exact: true })).toHaveCount(1);
    await expect(page.getByLabel('License category', { exact: true })).toHaveValue('commercial');
    if (width <= 1100) {
      await page.locator('.catalog-advanced > summary').click();
      await expect(page.getByLabel('License category', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    const bar = (await page.getByRole('region', { name: 'Catalog status' }).boundingBox())!;
    expect(bar.y + bar.height).toBeCloseTo(900, 0);
    await expect(page.locator('.catalog-footbar #catalog-count')).toBeInViewport();
    const count = (await page.locator('#catalog-count').boundingBox())!;
    const shuffle = (await page.locator('#catalog-shuffle').boundingBox())!;
    expect(count.x + count.width).toBeLessThanOrEqual(shuffle.x);
  }
  await page.locator('.catalog-notes > summary').click();
  await expect(page.locator('.catalog-totals')).toBeVisible();
  const information = (await page.locator('.catalog-notes > div').boundingBox())!;
  expect(information.x).toBeGreaterThanOrEqual(0);
  expect(information.x + information.width).toBeLessThanOrEqual(1440);
  await page.keyboard.press('Escape');
  await expect(page.locator('.catalog-notes')).not.toHaveAttribute('open');
});

test('every rendered and asynchronously replaced scene has a copyable short link and a native viewer document', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (value: string) => { (window as Window & { copiedDatasetLink?: string }).copiedDatasetLink = value; },
  } }));
  await page.goto('/hub/datasets/');
  for (const query of ['', 'SceauxCastle']) {
    if (query) {
      await page.getByRole('searchbox', { name: 'Search datasets' }).fill(query);
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(query);
    }
    const card = page.locator('.dataset-card').first();
    const id = await card.getAttribute('data-entry-id');
    const path = (await card.locator('.dataset-open').getAttribute('href'))!;
    expect(path).toMatch(/^\/s\/d\/[A-Za-z0-9_-]{16}$/);
    await card.locator('.dataset-info').click();
    const panel = card.locator('.dataset-metadata');
    await panel.getByRole('button', { name: 'Copy link', exact: true }).click();
    const shortUrl = new URL(path, page.url()).href;
    await expect.poll(() => page.evaluate(() => (window as Window & { copiedDatasetLink?: string }).copiedDatasetLink)).toBe(shortUrl);
    await expect(panel.locator('[data-copy-status]')).toHaveText('Link copied');
    const viewer = await page.request.get(path, { headers: { 'Sec-Fetch-Dest': 'document' }, maxRedirects: 0 });
    const original = await page.request.get(`/hub/datasets/open/${id}`, { maxRedirects: 0 });
    expect(viewer.status()).toBe(200);
    expect(viewer.headers().location).toBeUndefined();
    expect(await viewer.text()).toContain(JSON.stringify({ version: 1, viewerUrl: original.headers().location }));
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
  }
  const card = page.locator('.dataset-card').first();
  await card.locator('.dataset-info').click();
  const panel = card.locator('.dataset-metadata');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }));
  await panel.getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect(panel.locator('[data-copy-status] a')).toHaveAttribute('href', new URL((await card.locator('.dataset-open').getAttribute('href'))!, page.url()).href);
  await expect(panel.getByRole('button', { name: 'Copy link', exact: true })).toBeEnabled();
});
