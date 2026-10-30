import { expect, test } from '@playwright/test';

test('the Hub brand opens a fresh tab and Info retains policy links', async ({ page }) => {
  await page.goto('/hub/?q=SceauxCastle&viewerHost=github');
  const opened = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Spatial Hub', exact: true }).click();
  const hub = await opened;
  try {
    await expect(hub).toHaveURL(/\/hub\/\?viewerHost=github$/);
    expect(await hub.evaluate(() => window.opener)).toBeNull();
    await expect(page.getByRole('searchbox')).toHaveValue('SceauxCastle');
    await hub.locator('.catalog-notes > summary').click();
    const policies = hub.getByRole('navigation', { name: 'About and policies' });
    for (const [name, path] of [['About', 'about.html'], ['Privacy', 'privacy.html'], ['Terms', 'terms.html']]) {
      const link = policies.getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', `https://colmapview.github.io/latest/${path}`);
      await expect(link).toHaveAttribute('target', '_blank');
    }
  } finally { await hub.close(); }
});

for (const hasTouch of [false, true]) test.describe(`thumbnail tags with touch=${hasTouch}`, () => {
  test.use({ hasTouch });
  test('shows data and license tags without hover', async ({ page }) => {
    await page.setViewportSize({ width: hasTouch ? 390 : 1280, height: 900 });
    await page.goto('/hub/?q=SceauxCastle');
    await page.mouse.move(0, 0);
    const card = page.locator('.dataset-card').first();
    const tags = card.locator('.dataset-card-tags');
    await expect(tags).toBeVisible();
    await expect(tags).toHaveCSS('opacity', '1');
    await expect(tags).toHaveCSS('visibility', 'visible');
    await expect(tags.locator('[data-asset="images"]')).toBeVisible();
    await expect(tags.locator('[data-asset="cameras"]')).toBeVisible();
    await expect(tags.locator('[aria-label^="License:"]')).toBeVisible();
    await expect(card.locator('.dataset-info')).toHaveCSS('opacity', '1');
    const image = (await card.locator('.dataset-card-preview').boundingBox())!;
    const labels = (await tags.boundingBox())!;
    expect(labels.y + labels.height).toBeLessThanOrEqual(image.y + image.height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`catalog-tags-${hasTouch ? 'touch' : 'desktop'}.png`), fullPage: false });
  });
});

test('GitHub arrivals keep their viewer through async results, pagination, reset and metadata', async ({ page }) => {
  await page.goto('/hub/?viewerHost=github&seed=12345678');
  await expect(page.getByRole('link', { name: 'Open viewer', exact: true })).toHaveAttribute('href', 'https://colmapview.github.io/latest/');
  const cards = page.locator('#catalog-results .dataset-card');
  const checkLinks = async () => {
    const links = await cards.locator('.dataset-open').evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).href));
    expect(links.length).toBeGreaterThan(0);
    expect(links.every(href => new URL(href).searchParams.get('viewerHost') === 'github')).toBe(true);
  };
  await checkLinks();
  const initial = await cards.count();
  await page.locator('#catalog-more').click();
  await expect.poll(() => cards.count()).toBeGreaterThan(initial);
  await checkLinks();
  await page.getByRole('searchbox', { name: 'Search datasets' }).fill('SceauxCastle');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('SceauxCastle');
  expect(new URL(page.url()).searchParams.get('viewerHost')).toBe('github');
  await checkLinks();
  const card = cards.first();
  const path = (await card.locator('.dataset-open').getAttribute('href'))!;
  const id = await card.getAttribute('data-entry-id');
  const normal = await page.request.get('/hub/open/' + id, { maxRedirects: 0 });
  const github = await page.request.get(path, { headers: { 'Sec-Fetch-Dest': 'document' }, maxRedirects: 0 });
  expect(github.status()).toBe(302);
  const selected = new URL(github.headers().location), original = new URL(normal.headers().location);
  expect(selected.origin).toBe('https://colmapview.github.io');
  expect(selected.pathname).toBe('/latest/');
  expect(selected.search).toBe(original.search); expect(selected.hash).toBe(original.hash);
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search datasets' })).toHaveValue('');
  expect(new URL(page.url()).searchParams.get('viewerHost')).toBe('github');
  await checkLinks();
  await page.getByRole('searchbox', { name: 'Search datasets' }).fill('SceauxCastle');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('SceauxCastle');
  await cards.first().locator('.dataset-info').click();
  const panel = cards.first().getByRole('dialog');
  await panel.getByRole('link', { name: 'Full metadata', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open viewer', exact: true })).toHaveAttribute('href', 'https://colmapview.github.io/latest/');
  const action = page.getByRole('link', { name: 'Try in ColmapView', exact: false });
  await expect(action).toHaveAttribute('href', /viewerHost=github/);
  await page.getByRole('link', { name: 'All datasets', exact: false }).click();
  expect(new URL(page.url()).searchParams.get('viewerHost')).toBe('github');
});

test.use({ hasTouch: true });

test('catalog controls stay on one row and responsive filters keep their values', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/hub/');
  await page.locator('.catalog-advanced > summary').click();
  await page.getByLabel('License category', { exact: true }).selectOption('commercial');
  await expect.poll(() => new URL(page.url()).searchParams.get('licenseCategory')).toBe('commercial');
  await page.keyboard.press('Escape');
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
    await expect(page.locator('.catalog-footbar #catalog-notice')).toBeInViewport();
    const notice = (await page.locator('#catalog-notice').boundingBox())!;
    const shuffle = (await page.locator('#catalog-shuffle').boundingBox())!;
    if (width > 600) expect(notice.x + notice.width).toBeLessThanOrEqual(shuffle.x);
    else expect(notice.y + notice.height).toBeLessThanOrEqual(shuffle.y);
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
  await page.goto('/hub/');
  for (const query of ['', 'SceauxCastle']) {
    if (query) {
      await page.getByRole('searchbox', { name: 'Search datasets' }).fill(query);
      await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(query);
    }
    const card = page.locator('.dataset-card').first();
    const id = await card.getAttribute('data-entry-id');
    const path = (await card.locator('.dataset-open').getAttribute('href'))!;
    expect(path).toMatch(/^\/s\/[A-Z][a-z]{2,13}[A-Z][a-z]{2,13}$/);
    await card.locator('.dataset-info').click();
    const panel = card.locator('.dataset-metadata');
    await panel.getByRole('button', { name: 'Copy link', exact: true }).click();
    const shortUrl = new URL(path, page.url()).href;
    await expect.poll(() => page.evaluate(() => (window as Window & { copiedDatasetLink?: string }).copiedDatasetLink)).toBe(shortUrl);
    await expect(panel.locator('[data-copy-status]')).toHaveText('Link copied');
    const viewer = await page.request.get(path, { headers: { 'Sec-Fetch-Dest': 'document' }, maxRedirects: 0 });
    const original = await page.request.get(`/hub/open/${id}`, { maxRedirects: 0 });
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


test('search feedback, access filters and inline recovery stay concise and preserve metadata launch destinations', async ({ page }) => {
  await page.goto('/hub/?q=SceauxCastle&viewerHost=github');
  const count = page.locator('#catalog-count');
  await expect(count).toBeVisible();
  await expect(count).toHaveText('1');
  const card = page.locator('.dataset-card').first();
  const destination = await card.locator('.dataset-open').getAttribute('href');
  await card.locator('.dataset-info').click();
  await expect(card.getByRole('link', { name: 'Open in viewer', exact: true })).toHaveAttribute('href', destination!);
  await page.keyboard.press('Escape');

  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/hub/datasets/api/entries?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') === 'zzzznohitreview') await gate;
    await route.continue();
  });
  await page.getByRole('searchbox').fill('zzzznohitreview');
  try {
    await expect(count).toHaveText('Searching…');
    await expect(page.locator('#catalog-results')).toHaveAttribute('aria-busy', 'true');
  } finally { release(); }
  await expect(count).toHaveText('No matches');
  await page.getByRole('link', { name: 'Clear search and filters', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.getByRole('searchbox')).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBeNull();
  await expect(page.locator('.dataset-card').first()).toBeVisible();

  const filters = page.locator('.catalog-advanced > summary');
  await filters.click();
  await expect(page.getByLabel('Access', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Provider', { exact: true })).toBeHidden();
  await page.locator('.catalog-filter-details > summary').click();
  await page.getByLabel('Provider', { exact: true }).selectOption('huggingface');
  await expect.poll(() => new URL(page.url()).searchParams.get('provider')).toBe('huggingface');
  await page.locator('.catalog-filter-details > summary').click();
  await page.getByLabel('Access', { exact: true }).selectOption('gated');
  await expect.poll(() => new URL(page.url()).searchParams.get('access')).toBe('gated');
  await expect(filters).toHaveAccessibleName(/2 active.*Approval or sign-in required/);
  await expect(filters.locator('.catalog-filter-count')).toHaveText('2');
  await expect(page.locator('[data-extra-count]')).toHaveText('1 active');
  await expect(page.getByLabel('Provider', { exact: true })).toBeHidden();
  await page.goBack();
  await expect(page.getByLabel('Access', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Provider', { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('Access', { exact: true })).toHaveValue('gated');
  await page.keyboard.press('Escape');
  await expect(page.locator('.dataset-card').first()).toContainText('HF login required');
  const response = await page.request.get('/hub/datasets/api/entries?provider=huggingface&access=gated');
  expect(response.ok()).toBe(true);
  const data = await response.json();
  expect(data.entries.length).toBeGreaterThan(0);
  expect(data.entries.every((entry: { access: string }) => entry.access === 'gated')).toBe(true);
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await expect(filters.locator('.catalog-filter-count')).toBeHidden();
  expect(new URL(page.url()).searchParams.get('viewerHost')).toBe('github');
});
