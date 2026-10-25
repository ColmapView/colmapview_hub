import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { preview } from '../tests/fixtures/preview';

const origin = process.env.HUB_E2E_ORIGIN || `http://localhost:${process.env.HUB_E2E_PORT || '5201'}`;

const production = 'https://colmapview.opsiclear.com';
const choiceKey = 'colmapview-hub-analytics-v1';
const analyticsCatalog = production + '/hub/datasets/?q=private-query#private-fragment';

async function mockCatalogAnalytics(page: Page): Promise<string[]> {
  const tags: string[] = [];
  await page.route(production + '/hub/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: origin + url.pathname + url.search });
    await route.fulfill({ response });
  });
  await page.route('https://www.googletagmanager.com/**', route => {
    tags.push(route.request().url());
    return route.fulfill({ contentType: 'application/javascript', body: '' });
  });
  return tags;
}

test('public catalog analytics waits for opt-in and uses clean URLs without cookies', async ({ page, context }) => {
  const tags = await mockCatalogAnalytics(page);
  const fonts: string[] = [];
  page.on('request', request => { if (request.resourceType() === 'font') fonts.push(request.url()); });
  await page.addInitScript(() => Object.defineProperty(document, 'referrer', { value: 'https://example.org/?url=private-referrer' }));
  await page.goto(analyticsCatalog);
  await expect(page.getByRole('region', { name: 'Optional analytics' })).toBeVisible();
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const allow = await page.getByRole('button', { name: 'Allow analytics', exact: true }).boundingBox();
    const decline = await page.getByRole('button', { name: 'No thanks', exact: true }).boundingBox();
    expect(allow && decline && Math.abs(allow.y - decline.y) < 1).toBe(true);
  }
  expect(tags).toHaveLength(0);
  expect(await page.evaluate(() => 'dataLayer' in window)).toBe(false);
  await page.getByRole('button', { name: 'Close analytics settings', exact: true }).click();
  await page.setViewportSize({ width: 360, height: 360 });
  const settings = page.getByRole('button', { name: 'Analytics settings', exact: true });
  const beforeScroll = await settings.boundingBox();
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const afterScroll = await settings.boundingBox();
  expect(beforeScroll && afterScroll && Math.abs(beforeScroll.y - afterScroll.y) < 1).toBe(true);
  expect(await page.evaluate(key => localStorage.getItem(key), choiceKey)).toBe(null);
  await settings.click();
  await page.getByRole('button', { name: 'No thanks', exact: true }).press('Escape');
  await expect(settings).toBeFocused();
  await settings.click();
  await page.getByRole('button', { name: 'No thanks', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Analytics settings' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Optional analytics' })).toBeHidden();
  expect(tags).toHaveLength(0);
  await page.getByRole('button', { name: 'Analytics settings' }).click();
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => tags.length).toBe(1);
  expect(tags[0]).toBe('https://www.googletagmanager.com/gtag/js?id=G-7K5H83SEMY');
  const commands = await page.evaluate(() => (window as Window & { dataLayer?: ArrayLike<unknown>[] }).dataLayer?.map(command => Array.from(command)) ?? []);
  expect(commands).toContainEqual(['consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
  expect(commands).toContainEqual(['config', 'G-7K5H83SEMY', expect.objectContaining({ page_location: production + '/hub/datasets/', page_referrer: '', send_page_view: false })]);
  expect(JSON.stringify(commands)).not.toContain('private-');
  expect((await context.cookies()).filter(cookie => cookie.name.startsWith('_ga'))).toEqual([]);
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every(url => new URL(url).origin === production)).toBe(true);
  const license = await page.request.get(origin + '/hub/fonts/OFL.txt');
  expect(license.status()).toBe(200);
  expect(await license.text()).toContain('Copyright 2019 IBM Corp.');
  await page.unrouteAll({ behavior: 'wait' });
});

test('public catalog analytics withdraws consent across tabs and discards loaded tags', async ({ page, context }) => {
  const tags = await mockCatalogAnalytics(page);
  await page.goto(analyticsCatalog);
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => tags.length).toBe(1);
  const other = await context.newPage();
  const otherTags = await mockCatalogAnalytics(other);
  await other.goto(analyticsCatalog);
  await expect.poll(() => otherTags.length).toBe(1);
  await page.getByRole('button', { name: 'Analytics settings' }).click();
  const reloads = [page.waitForEvent('domcontentloaded'), other.waitForEvent('domcontentloaded')];
  await page.getByRole('button', { name: 'No thanks', exact: true }).click();
  await Promise.all(reloads);
  for (const tab of [page, other]) {
    await expect(tab.getByRole('button', { name: 'Analytics settings' })).toBeVisible();
    expect(await tab.evaluate(() => 'dataLayer' in window)).toBe(false);
    await tab.unrouteAll({ behavior: 'wait' });
  }
  expect(tags).toHaveLength(1);
  expect(otherTags).toHaveLength(1);
});

for (const signal of ['doNotTrack', 'globalPrivacyControl'] as const) {
  test(`public catalog analytics respects ${signal} even with saved consent`, async ({ page }) => {
    const tags = await mockCatalogAnalytics(page);
    await page.addInitScript(({ key, signal }) => {
      localStorage.setItem(key, JSON.stringify({ choice: 'allow', updatedAt: Date.now() }));
      Object.defineProperty(navigator, signal, { value: signal === 'doNotTrack' ? '1' : true });
    }, { key: choiceKey, signal });
    await page.goto(analyticsCatalog);
    await page.getByRole('button', { name: 'Analytics settings' }).click();
    await expect(page.getByRole('button', { name: 'Allow analytics', exact: true })).toBeDisabled();
    await expect(page.locator('#analytics-status')).toHaveText(`Analytics off: ${signal === 'doNotTrack' ? 'Do Not Track' : 'Global Privacy Control'} is enabled.`);
    expect(await page.evaluate(() => 'dataLayer' in window)).toBe(false);
    expect(tags).toHaveLength(0);
    await page.unrouteAll({ behavior: 'wait' });
  });
}

for (const [label, saved] of [
  ['malformed', 'invalid-json'],
  ['expired', JSON.stringify({ choice: 'allow', updatedAt: Date.now() - 181 * 86400000 })],
  ['future date', JSON.stringify({ choice: 'allow', updatedAt: Date.now() + 86400000 })],
]) {
  test(`public catalog analytics rejects invalid permission: ${label}`, async ({ page }) => {
    const tags = await mockCatalogAnalytics(page);
    await page.addInitScript(({ key, saved }) => localStorage.setItem(key, saved), { key: choiceKey, saved });
    await page.goto(analyticsCatalog);
    await expect(page.getByRole('region', { name: 'Optional analytics' })).toBeVisible();
    expect(await page.evaluate(() => 'dataLayer' in window)).toBe(false);
    expect(tags).toHaveLength(0);
    await page.unrouteAll({ behavior: 'wait' });
  });
}

test('public catalog analytics stays off when permission cannot be stored', async ({ page }) => {
  const tags = await mockCatalogAnalytics(page);
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) Object.defineProperty(Storage.prototype, method, {
      value() { throw new DOMException('Storage blocked', 'SecurityError'); },
    });
  });
  await page.goto(analyticsCatalog);
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect(page.locator('#analytics-status')).toContainText('Analytics stays off');
  expect(await page.evaluate(() => 'dataLayer' in window)).toBe(false);
  expect(tags).toHaveLength(0);
  await page.unrouteAll({ behavior: 'wait' });
});

test('public catalog analytics disables measurement if saving withdrawal fails', async ({ page }) => {
  const tags = await mockCatalogAnalytics(page);
  await page.goto(analyticsCatalog);
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => tags.length).toBe(1);
  await page.evaluate(() => Object.defineProperty(Storage.prototype, 'setItem', {
    configurable: true, value() { throw new DOMException('Storage full', 'QuotaExceededError'); },
  }));
  await page.getByRole('button', { name: 'Analytics settings' }).click();
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect(page.locator('#analytics-status')).toContainText('Your current analytics setting is unchanged');
  await page.getByRole('button', { name: 'No thanks', exact: true }).click();
  await expect(page.locator('#analytics-status')).toContainText('Clear this site’s data');
  expect(await page.evaluate(() => (window as Window & { 'ga-disable-G-7K5H83SEMY'?: boolean })['ga-disable-G-7K5H83SEMY'])).toBe(true);
  expect(tags).toHaveLength(1);
  await page.unrouteAll({ behavior: 'wait' });
});

let viewerServer: Server;
let viewerOrigin: string;

test.beforeAll(async () => {
  // Browser routing mocks do not intercept the document reached through an HTTP redirect.
  // A real loopback server verifies that handoff without contacting a deployed viewer.
  viewerServer = createServer((_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>Viewer fixture</title><h1>Viewer fixture</h1>');
  });
  await new Promise<void>((resolve, reject) => {
    viewerServer.once('error', reject);
    viewerServer.listen(0, '127.0.0.1', resolve);
  });
  const address = viewerServer.address();
  if (!address || typeof address === 'string') throw new Error('Viewer fixture did not start.');
  viewerOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (viewerServer) await new Promise<void>((resolve, reject) => viewerServer.close(error => error ? reject(error) : resolve()));
});

interface Link { id: string; url: string; shareUrl: string; owner: string }

async function createLink(page: Page, overrides: Record<string, unknown> = {}): Promise<Link> {
  const owner = randomBytes(32).toString('base64url');
  const response = await page.request.post('/hub/api/links', { headers: { Origin: origin }, data: {
    viewerUrl: 'https://colmapview.opsiclear.com/?url=https%3A%2F%2Fdata.example%2Fmanifest.json#camera=43',
    title: 'Example reconstruction', description: 'Public metadata, private source permissions.',
    thumbnailBase64: preview, managementSecret: owner, publicAcknowledged: true,
    license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
    assets: { format: 'zip', imageFormat: 'jpeg', colmap: { files: 5, cameras: 83, points: 83749 },
      images: 83, masks: 82, splats: 1, viewerSettings: true, preview: false },
    ...overrides,
  } });
  expect(response.status()).toBe(201);
  return { ...await response.json() as { id: string; url: string; shareUrl: string }, owner };
}

const removeLink = (page: Page, link: Link) =>
  page.request.delete(`/hub/api/links/${link.id}`, { headers: { Origin: origin, Authorization: `Bearer ${link.owner}` } });

/** WCAG contrast of two computed rgb() colors. */
function contrast(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
      .map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [1280, 360]) {
  test(`opens a shared result directly in the viewer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const viewerUrl = `${viewerOrigin}/?url=https%3A%2F%2Fdata.example%2Fmanifest.json#camera=43`;
    const link = await createLink(page, { viewerUrl });
    try {
      const redirected = page.waitForResponse(response => response.url() === link.shareUrl);
      await page.goto(link.shareUrl);
      expect((await redirected).status()).toBe(307);
      await expect(page).toHaveURL(viewerUrl);
      await expect(page.getByRole('heading', { name: 'Viewer fixture', exact: true })).toBeVisible();
      await expect(page.locator('iframe, #player')).toHaveCount(0);
      const metadata = await page.request.get(link.shareUrl);
      expect(metadata.status()).toBe(200);
      expect(await metadata.text()).toContain('<meta name="twitter:card" content="summary_large_image">');
    } finally { await removeLink(page, link); }
  });
}

test('deletes a link from its delete link and moves focus to the result', async ({ page }) => {
  const link = await createLink(page);
  let deleted = false;
  try {
    await page.goto(`/hub/manage/${link.id}#${link.owner}`);
    await expect(page.getByRole('heading', { name: 'Delete Hub link “Example reconstruction”?' })).toBeVisible();
    await expect(page.getByText('The dataset stays where it is.')).toBeVisible();
    await expect(page.locator('img.thumbnail')).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    const status = page.getByRole('status');
    await expect(status).toHaveText('Hub link deleted.');
    await expect(status).toBeFocused();
    deleted = true;
    expect(new URL(page.url()).hash).toBe('');
    expect((await page.request.get(link.url)).status()).toBe(404);
  } finally { if (!deleted) await removeLink(page, link); }
});

test('disables deletion when the delete link lost its key', async ({ page }) => {
  const link = await createLink(page);
  try {
    await page.goto(`/hub/manage/${link.id}`);
    await expect(page.getByRole('status')).toHaveText('This delete link is incomplete. Open the full link saved when the Hub link was created.');
    await expect(page.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  } finally { await removeLink(page, link); }
});

test('picks up a delete key that arrives or changes after the page loaded', async ({ page }) => {
  const link = await createLink(page);
  let deleted = false;
  try {
    await page.goto(`/hub/manage/${link.id}`);
    const button = page.getByRole('button', { name: 'Delete permanently', exact: true });
    const status = page.getByRole('status');
    await expect(button).toBeDisabled();
    await page.evaluate(() => { location.hash = 'too-short'; });
    await expect(button).toBeDisabled();
    await expect(status).toHaveText('This delete link is incomplete. Open the full link saved when the Hub link was created.');
    // A well-formed but wrong key enables the button; correcting it in the same tab must send the new key.
    const wrong = 'B'.repeat(43);
    await page.evaluate(key => { location.hash = key; }, wrong);
    await expect(button).toBeEnabled();
    await expect(page.locator('#status')).toHaveText('');
    await page.evaluate(key => { location.hash = key; }, link.owner);
    await expect(button).toBeEnabled();
    const sent = page.waitForRequest(request => request.method() === 'DELETE');
    await button.click();
    expect((await sent).headers().authorization).toBe(`Bearer ${link.owner}`);
    await expect(status).toHaveText('Hub link deleted.');
    deleted = true;
    expect(new URL(page.url()).hash).toBe('');
    await expect(button).toBeDisabled();
    expect((await page.request.get(link.url)).status()).toBe(404);
  } finally { if (!deleted) await removeLink(page, link); }
});

test('keeps the delete key across the letter-case redirect', async ({ page }) => {
  const link = await createLink(page);
  try {
    // The 308 Location has no fragment, so the browser carries the key over.
    await page.goto(`/hub/manage/${link.id.toLowerCase()}#${link.owner}`);
    expect(new URL(page.url()).pathname).toBe(`/hub/manage/${link.id}`);
    expect(new URL(page.url()).hash).toBe(`#${link.owner}`);
    await expect(page.getByRole('button', { name: 'Delete permanently', exact: true })).toBeEnabled();
  } finally { await removeLink(page, link); }
});

test('explains a failed deletion and lets the owner try again', async ({ page }) => {
  const link = await createLink(page);
  try {
    await page.goto(`/hub/manage/${link.id}#${link.owner}`);
    const button = page.getByRole('button', { name: 'Delete permanently', exact: true });
    const status = page.getByRole('status');
    for (const [reply, text] of [
      [{ status: 503 }, 'ColmapView Hub is unavailable. Try again in a few minutes.'],
      [{ status: 429, headers: { 'Retry-After': '30' } }, 'Too many missing links from your network. Try again in 1 minute.'],
      [{ status: 404 }, "This delete link doesn't match the Hub link."],
    ] as const) {
      await page.route('**/hub/api/links/*', route => route.fulfill(reply), { times: 1 });
      await button.click();
      await expect(status).toHaveText(text);
      await expect(status).toBeFocused();
      await expect(button).toBeEnabled();
    }
  } finally { await removeLink(page, link); }
});

test('opens a private Drive result directly so the viewer can request access', async ({ page }) => {
  const viewerUrl = `${viewerOrigin}/?url=https://drive.google.com/file/d/private-fixture/view`;
  const link = await createLink(page, { access: 'private', viewerUrl });
  try {
    await page.goto(link.shareUrl);
    await expect(page).toHaveURL(viewerUrl);
    await expect(page.getByRole('heading', { name: 'Viewer fixture' })).toBeVisible();
    await expect(page.locator('iframe, #player')).toHaveCount(0);
  } finally { await removeLink(page, link); }
});

test('opens datasets from the Hub home without an upload form or horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  expect((await page.goto('/hub/'))!.status()).toBe(200);
  await expect(page).toHaveURL(/\/hub\/datasets\/$/);
  await expect(page.locator('input[type="file"], textarea')).toHaveCount(0);
  expect(await noHorizontalScroll(page)).toBe(true);
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`matches ColmapView in the ${colorScheme} color scheme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.addInitScript(() => localStorage.setItem('colmap-viewer-theme', 'system'));
    const link = await createLink(page);
    try {
      for (const path of ['/hub/datasets/', `/hub/manage/${link.id}#${link.owner}`]) {
        await page.goto(path);
        const fonts = await page.evaluate(async () => {
          await document.fonts.ready;
          return [...document.fonts].filter(face => face.family.replace(/"/g, '') === 'IBM Plex Sans Variable').map(face => face.status);
        });
        expect(fonts).toContain('loaded');
        expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
          .toBe(colorScheme === 'dark' ? 'rgb(15, 15, 15)' : 'rgb(245, 245, 244)');
        const [foreground, background] = await page.locator('.button-primary, .button-danger')
          .evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).backgroundColor]);
        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        for (const target of await page.locator('.site-nav a, .footer-links a, .brand, .button').filter({ visible: true }).all()) {
          expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(32);
        }
      }
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(`/hub/manage/${link.id}#${link.owner}`);
      expect(await noHorizontalScroll(page)).toBe(true);
    } finally { await removeLink(page, link); }
  });
}

test('the appearance icon supports keyboard cycling, persistence and system and cross-tab changes', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/hub/datasets/?q=SceauxCastle');
  const theme = page.getByRole('button', { name: /^Appearance:/ });
  const root = page.locator('html');
  await expect(theme).toHaveAccessibleName('Appearance: Dark. Switch to Light.');
  await theme.press('Enter');
  await expect(root).toHaveAttribute('data-ui-theme', 'light');
  await page.reload();
  await expect(theme).toHaveAccessibleName('Appearance: Light. Switch to System.');
  await expect(root).toHaveAttribute('data-ui-theme', 'light');
  await theme.press('Space');
  await expect(theme).toHaveAccessibleName('Appearance: System. Switch to Dark.');
  await expect(root).toHaveAttribute('data-ui-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-ui-theme', 'light');
  const other = await context.newPage();
  try {
    await other.goto('/hub/datasets/?q=SceauxCastle');
    await other.getByRole('button', { name: 'Appearance: System. Switch to Dark.', exact: true }).click();
    await expect(theme).toHaveAccessibleName('Appearance: Dark. Switch to Light.');
    await expect(root).toHaveAttribute('data-ui-theme', 'dark');
  } finally { await other.close(); }
});

test('gives the primary and danger buttons the type of link buttons', async ({ page }) => {
  const link = await createLink(page);
  const type = (selector: string) => page.locator(selector).evaluate(element =>
    [getComputedStyle(element).fontFamily, getComputedStyle(element).fontSize, getComputedStyle(element).fontWeight]);
  try {
    await page.goto('/hub/datasets/');
    const linkType = await type('#catalog-reset');
    expect(await type('.button-primary')).toEqual(linkType);
    await page.goto(`/hub/manage/${link.id}#${link.owner}`);
    expect(await type('.button-danger')).toEqual(linkType);
  } finally { await removeLink(page, link); }
});

test('serves static files without the Worker, with nosniff and revalidation', async ({ page }) => {
  for (const path of ['/hub/styles.css', '/hub/colmapview.css', '/hub/assets/client.js', '/hub/fonts/ibm-plex-sans-latin-wght-normal.woff2', '/hub/favicon.ico']) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-content-type-options'], path).toBe('nosniff');
    expect(response.headers().etag, path).toBeTruthy();
  }
});

test('long titles stay within a narrow management page and delete keys never enter public URLs', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const link = await createLink(page, { title: 'A'.repeat(120), viewerUrl: 'https://colmapview.github.io/latest/?url=https%3A%2F%2Fdata.example%2Fmanifest.json' });
  try {
    expect(new URL(link.url).hash).toBe('');
    await page.goto(`/hub/manage/${link.id}#${link.owner}`);
    expect(await noHorizontalScroll(page)).toBe(true);
  } finally { expect((await removeLink(page, link)).status()).toBe(204); }
});

test('preserves saved filters after their redundant controls are removed', async ({ page, browser }) => {
  const path = '/hub/datasets/?delivery=cors_headers_checked&viewer=available';
  await page.goto(path);
  await expect(page.locator('select[name="delivery"],select[name="viewer"]')).toHaveCount(0);
  await expect(page.locator('#catalog-saved-filters')).toContainText('Model links only');
  await page.locator('#catalog-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
  expect(new URL(page.url()).searchParams.get('delivery')).toBe('cors_headers_checked');
  const resetResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/hub/datasets/api/entries') && !new URL(response.url()).searchParams.has('viewer'));
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  expect((await resetResponse).ok()).toBe(true);
  await expect(page.locator('#catalog-saved-filters')).toBeHidden();
  expect(new URL(page.url()).searchParams.has('viewer')).toBe(false);
  await page.goBack();
  await expect(page.locator('#catalog-saved-filters')).toContainText('Model links only');
  await expect(page.locator('input[name="delivery"]')).toHaveValue('cors_headers_checked');
  const fallback = await browser.newContext({ javaScriptEnabled: false });
  try {
    const serverPage = await fallback.newPage();
    await serverPage.goto(origin + path.replace('?', '?q=large_overlap&'));
    await expect(serverPage.locator('#catalog-saved-filters')).toContainText('Model links only');
    const next = new URL((await serverPage.locator('#catalog-next').getAttribute('href'))!, origin);
    expect(next.searchParams.get('delivery')).toBe('cors_headers_checked');
    expect(next.searchParams.get('viewer')).toBe('available');
    expect(next.searchParams.get('page')).toBe('2');
    await expect(serverPage.getByRole('searchbox', { name: 'Search datasets' })).toHaveValue('large_overlap');
    await serverPage.getByRole('link', { name: 'Reset', exact: true }).click();
    await expect(serverPage).toHaveURL(origin + '/hub/datasets/');
    await expect(serverPage.getByRole('searchbox', { name: 'Search datasets' })).toHaveValue('');
    await expect(serverPage.locator('#catalog-saved-filters')).toBeHidden();
    await expect(serverPage.locator('.dataset-card')).toHaveCount(24);
  } finally { await fallback.close(); }
});

test('opens the scene browser directly in the ColmapView frame', async ({ page }) => {
  await page.goto('/hub/');
  await expect(page).toHaveURL(/\/hub\/datasets\/$/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Open viewer' })).toHaveAttribute('href', 'https://colmapview.opsiclear.com/');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Datasets', exact: true })).toHaveAttribute('href', '/hub/datasets/');
  await expect(page.getByRole('navigation', { name: 'Footer navigation' }).getByRole('link')).toHaveText(['About', 'Privacy', 'Terms', 'Source', 'Contact']);
  await expect(page.getByLabel('Collection', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Public datasets', exact: true })).toBeVisible();
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  await page.locator('#catalog-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search datasets' }).fill('large_overlap basketball sparse_native');
  await expect(page.locator('.dataset-card')).toHaveCount(1);
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search datasets' })).toHaveValue('');
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  await page.getByText('More filters', { exact: true }).click();
  await page.getByLabel('Type', { exact: true }).selectOption('COLMAP reconstruction');
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await expect(page.locator('select[name="viewer"], select[name="delivery"]')).toHaveCount(0);
  await page.getByLabel('Evidence', { exact: true }).selectOption('Native COLMAP layout checked');
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('Native COLMAP layout checked');
  await expect(page.locator('.dataset-card').getByText('Native COLMAP layout checked', { exact: true })).toHaveCount(24);
  await expect(page.locator('.dataset-card .dataset-metadata dt').filter({ hasText: /^Delivery$/ })).toHaveCount(24);
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search datasets' }).fill('large_overlap basketball sparse_native');
  await page.getByRole('button', { name: /^Metadata for .*basketball.*sparse_native/ }).click();
  await page.getByRole('link', { name: 'Full metadata', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dataset information', exact: true })).toBeVisible();
  await expect(page.getByText('License (source metadata)', { exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText('Not specified');
  await expect(page.locator('main')).toContainText('Verified original photographs');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('.dataset-thumbnail')).toBeVisible();
  await expect(page.locator('.dataset-thumbnail')).toHaveAttribute('src', /^\/hub\/datasets\/individual\/thumbnails\/[a-f0-9]{64}\.jpg$/);
  await page.getByRole('link', { name: '← All datasets', exact: true }).click();
  await page.getByText('About this catalog', { exact: true }).click();
  await page.getByRole('link', { name: 'Audit and coverage', exact: true }).click();
  await expect(page).toHaveURL(origin + '/hub/datasets/audit');
  await expect(page.getByRole('heading', { name: 'Dataset audit', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download verified scene checks (JSON)', exact: true })).toHaveAttribute('href', '/hub/datasets/individual/verified-scenes.json');
  await expect(page.getByRole('link', { name: 'Download public audit records (JSON)', exact: true })).toHaveAttribute('href', '/hub/datasets/dataset-audit.json');
  const removedManifest = await page.request.get('/hub/datasets/public-megascenes-000000-arc-de-bera-component-0-native-complete-99744eaac47a.manifest.json');
  expect(removedManifest.status()).toBe(404);
});
