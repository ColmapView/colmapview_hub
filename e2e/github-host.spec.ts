import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const github = 'https://colmapview.github.io';
const production = 'https://colmapview.opsiclear.com';
const local = process.env.HUB_E2E_ORIGIN || `http://localhost:${process.env.HUB_E2E_PORT || '5201'}`;

test('public export downloads are exact HTTP 200 files without HTML canonicalization redirects', async ({ request }) => {
  const audit = await request.get(local + '/hub/datasets/audit', { maxRedirects: 0 });
  expect(audit.status()).toBe(308);
  expect(audit.headers().location).toBe(local + '/hub/datasets/audit.html');
  const metadata = await request.get(local + '/hub/assets/github/site.json');
  expect(metadata.status()).toBe(200);
  const manifest = await metadata.json() as { files: { artifact: string; sha256: string; bytes: number }[] };
  for (const file of manifest.files) {
    const response = await request.get(local + file.artifact, { maxRedirects: 0, headers: { Origin: github } });
    expect(response.status()).toBe(200);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    const bytes = await response.body();
    expect(bytes.length).toBe(file.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
  }
});

test.beforeEach(async ({ page }) => {
  const manifest = JSON.parse(await readFile('public/hub/assets/github/site.json', 'utf8')) as { files: { path: string; artifact: string }[] };
  await page.route(github + '/hub/**', async route => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/hub\//, '');
    const file = manifest.files.find(file => file.path === pathname + 'index.html');
    if (!file) { await route.fulfill({ status: 404 }); return; }
    await route.fulfill({ contentType: 'text/html', body: await readFile('public' + file.artifact) });
  });
  await page.route(production + '/hub/**', async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await route.fetch({ url: local + url.pathname + url.search }) });
  });
});

test.afterEach(async ({ page }) => {
  // Finish proxied asset requests before Playwright disposes the browser context.
  await page.unrouteAll({ behavior: 'wait' });
});

test('GitHub gallery keeps browsing, search, metadata and Back on GitHub using public APIs', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: github });
  const errors: string[] = [];
  const google: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/google-analytics|googletagmanager/.test(request.url())) google.push(request.url()); });
  await page.goto(github + '/hub/datasets/?q=SceauxCastle');
  const cards = page.locator('#catalog-results [data-entry-id]');
  await expect(cards.first()).toBeVisible();
  expect(new URL(page.url()).origin).toBe(github);
  await expect(page.getByRole('searchbox')).toHaveValue('SceauxCastle');
  await expect(page.getByRole('link', { name: 'Open viewer', exact: true })).toHaveAttribute('href', github + '/latest/');
  expect(google).toEqual([]);
  await page.getByRole('button', { name: 'No thanks', exact: true }).click();
  await expect(cards.first().locator('.dataset-open')).toHaveAttribute('href', /^https:\/\/colmapview.opsiclear.com\/s\/.+viewerHost=github$/);
  await cards.first().locator('.dataset-info').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Copy link', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^https:\/\/colmapview.opsiclear.com\/s\/[A-Z][a-z]+[A-Z][a-z]+$/);
  await page.getByRole('dialog').getByRole('link', { name: 'Full metadata', exact: true }).click();
  await expect(page).toHaveURL(/^https:\/\/colmapview.github.io\/hub\/datasets\/entry\/\?id=data-/);
  await expect(page.locator('.dataset-overview')).toBeVisible();
  await page.goBack();
  await expect(cards.first()).toBeVisible();
  const search = page.getByRole('searchbox');
  await search.fill('colmapview_nonexistent_scene_qzx'); await search.press('Enter');
  await expect(page.locator('#catalog-count')).toHaveText('No matching datasets');
  expect(new URL(page.url()).origin).toBe(github);
  expect(errors).toEqual([]);
});

test('GitHub root gallery loads asynchronously without redirects or pre-consent Google requests', async ({ page }) => {
  await page.goto(github + '/hub/');
  await expect(page.locator('#catalog-results [data-entry-id]').first()).toBeVisible();
  expect(new URL(page.url()).origin).toBe(github);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.locator('#catalog-results img').first()).toBeVisible();
  await expect.poll(() => page.locator('#catalog-results img').first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
});

test('GitHub analytics waits for consent, saves the first-party choice and excludes URL queries', async ({ page }) => {
  const tags: string[] = [];
  await page.route('https://www.googletagmanager.com/**', route => {
    tags.push(route.request().url()); return route.fulfill({ contentType: 'application/javascript', body: '' });
  });
  await page.goto(github + '/hub/datasets/?q=private-query#private-fragment');
  await expect(page.getByRole('button', { name: 'Allow analytics', exact: true })).toBeVisible();
  expect(tags).toEqual([]);
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => tags.length).toBe(1);
  const commands = await page.evaluate(() => (window as Window & { dataLayer?: ArrayLike<unknown>[] }).dataLayer?.map(value => Array.from(value)) || []);
  expect(JSON.stringify(commands)).not.toMatch(/private-query|private-fragment/);
  expect(commands).toContainEqual(['config', 'G-7K5H83SEMY', expect.objectContaining({ cookie_domain: 'colmapview.github.io', cookie_path: '/hub/datasets' })]);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Optional analytics' })).toBeHidden();
  await expect.poll(() => tags.length).toBe(2);
});

test('GitHub respects browser privacy signals before any analytics opt-in', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'globalPrivacyControl', { value: true }));
  const tags: string[] = [];
  page.on('request', request => { if (/google-analytics|googletagmanager/.test(request.url())) tags.push(request.url()); });
  await page.goto(github + '/hub/datasets/');
  await expect(page.locator('#catalog-results [data-entry-id]').first()).toBeVisible();
  // Observe the complete startup before asserting that no analytics request ran.
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('region', { name: 'Optional analytics' })).toBeHidden();
  expect(tags).toEqual([]);
});
