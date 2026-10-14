import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { preview } from '../tests/fixtures/preview';

const origin = 'http://localhost:5201';
interface Link { id: string; url: string; owner: string }

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
  return { ...await response.json() as { id: string; url: string }, owner };
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
  test(`shows and plays a result at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const link = await createLink(page);
    try {
      await page.goto(link.url);
      await expect(page.getByRole('heading', { name: 'Example reconstruction', exact: true })).toBeVisible();
      await expect(page.locator('.meta')).toHaveText('83 images · 83,749 points · 82 masks · 1 splat · License: CC BY 4.0');
      await expect(page.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
      expect(await page.locator('#player img').evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([600, 315]);
      expect(await noHorizontalScroll(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`card-${width}.png`), fullPage: true });
      await page.route('https://colmapview.opsiclear.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Interactive viewer fixture</h1>' }));
      await page.getByRole('button', { name: 'Play 3D', exact: true }).click();
      const frame = page.locator('iframe');
      await expect(frame).toBeFocused();
      const [height, viewport] = await frame.evaluate(element => [element.getBoundingClientRect().height, innerHeight]);
      expect(Math.abs(height - viewport * 0.7)).toBeLessThanOrEqual(3);
      const embed = new URL((await frame.getAttribute('src'))!);
      expect(embed.searchParams.get('embed')).toBe('1');
      expect(embed.hash).toBe('#camera=43');
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

test('shows a private card with a viewer link and no Play 3D', async ({ page }) => {
  const link = await createLink(page, { access: 'private' });
  try {
    await page.goto(link.url);
    await expect(page.getByRole('button', { name: 'Play 3D' })).toHaveCount(0);
    await expect(page.getByText('Viewers need access to open this dataset.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open in ColmapView' })).toHaveAttribute('target', '_blank');
  } finally { await removeLink(page, link); }
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`matches ColmapView in the ${colorScheme} color scheme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const link = await createLink(page);
    try {
      for (const path of [new URL(link.url).pathname, `/hub/manage/${link.id}#${link.owner}`]) {
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
        for (const target of await page.locator('.site-nav a, .footer-links a, .brand, .button').all()) {
          expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
      }
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(link.url);
      expect(await noHorizontalScroll(page)).toBe(true);
    } finally { await removeLink(page, link); }
  });
}

test('serves static files without the Worker, with nosniff and revalidation', async ({ page }) => {
  for (const path of ['/hub/styles.css', '/hub/colmapview.css', '/hub/assets/client.js', '/hub/fonts/ibm-plex-sans-latin-wght-normal.woff2', '/hub/favicon.ico']) {
    const response = await page.request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-content-type-options'], path).toBe('nosniff');
    expect(response.headers().etag, path).toBeTruthy();
  }
});

test('long titles stay within a narrow card and delete keys never enter public URLs', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const link = await createLink(page, { title: 'A'.repeat(120), viewerUrl: 'https://colmapview.github.io/latest/?url=https%3A%2F%2Fdata.example%2Fmanifest.json' });
  try {
    expect(new URL(link.url).hash).toBe('');
    await page.goto(link.url);
    expect(await noHorizontalScroll(page)).toBe(true);
  } finally { expect((await removeLink(page, link)).status()).toBe(204); }
});
