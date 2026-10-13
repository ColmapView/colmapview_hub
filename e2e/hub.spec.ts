import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { preview } from '../tests/fixtures/preview';

for (const width of [1280, 360]) {
  test(`shows, plays, and deletes a ${width === 360 ? 'listed' : 'unlisted'} result at ${width}px without a submission form`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const owner = randomBytes(32).toString('base64url');
    const origin = 'http://localhost:5201';
    const created = await page.request.post('/hub/api/links', { headers: { Origin: origin }, data: {
      viewerUrl: 'https://colmapview.opsiclear.com/?url=https%3A%2F%2Fdata.example%2Fmanifest.json#camera=43',
      title: 'Example reconstruction', description: 'Public metadata, private source permissions.',
      thumbnailBase64: preview, managementSecret: owner, publicAcknowledged: true, listed: width === 360,
      assets: { format: 'zip', imageFormat: 'jpeg', colmap: { files: 5, cameras: 83, points: 83749 },
        images: 83, masks: 82, splats: 1, viewerSettings: true, preview: false },
    } });
    expect(created.status()).toBe(201);
    const link = await created.json();
    let deleted = false;
    try {
      await page.goto('/hub/');
      await expect(page.getByRole('heading', { name: 'Shared results' })).toBeVisible();
      await expect(page.locator('input,textarea,form')).toHaveCount(0);
      await expect(page.locator('a.gallery-card')).toHaveCount(width === 360 ? 1 : 0);
      if (width === 360) await expect(page.locator('a.gallery-card .asset-summary')).toContainText('83 images (JPEG)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`gallery-${width}.png`) });
      await page.goto(link.url);
      await expect(page.getByRole('heading', { name: 'Example reconstruction', exact: true })).toBeVisible();
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
      await expect(page.getByLabel('Dataset assets', { exact: true })).toContainText('5 COLMAP files (83 cameras, 83,749 points)');
      await expect(page.getByLabel('Dataset assets', { exact: true })).toContainText('83 images (JPEG) · 82 masks · 1 Gaussian splat');
      expect(await page.locator('#player img').evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([600, 315]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.route('https://colmapview.opsiclear.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Interactive viewer fixture</h1>' }));
      await page.getByRole('button', { name: 'Play 3D', exact: true }).click();
      const frame = page.locator('iframe');
      await expect(frame).toBeVisible();
      const embed = new URL((await frame.getAttribute('src'))!);
      expect(embed.searchParams.get('embed')).toBe('1');
      expect(embed.hash).toBe('#camera=43');
      await page.goto(`/hub/manage/${link.id}#${owner}`);
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Delete link', exact: true }).click();
      await expect(page.getByRole('status')).toHaveText('Link deleted.');
      deleted = true;
      expect((await page.request.get(link.url)).status()).toBe(404);
      expect((await page.request.get(`${link.url}/preview.jpg`)).status()).toBe(404);
      await page.goto('/hub/');
      await expect(page.locator('a.gallery-card')).toHaveCount(0);
    } finally {
      if (!deleted) await page.request.delete(`/hub/api/links/${link.id}`, { headers: { Origin: origin, Authorization: `Bearer ${owner}` } });
    }
  });
}

test('long titles stay within a narrow result card and management keys never enter public URLs', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const owner = randomBytes(32).toString('base64url');
  const origin = 'http://localhost:5201';
  const created = await page.request.post('/hub/api/links', { headers: { Origin: origin }, data: {
    viewerUrl: 'https://colmapview.github.io/latest/?url=https%3A%2F%2Fdata.example%2Fmanifest.json', title: 'A'.repeat(120),
    thumbnailBase64: preview, managementSecret: owner, publicAcknowledged: true, listed: false,
  } });
  expect(created.status()).toBe(201);
  const link = await created.json();
  try {
    expect(new URL(link.url).hash).toBe('');
    await page.goto(link.url);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    const deleted = await page.request.delete(`/hub/api/links/${link.id}`, { headers: { Origin: origin, Authorization: `Bearer ${owner}` } });
    expect(deleted.status()).toBe(204);
  }
});
