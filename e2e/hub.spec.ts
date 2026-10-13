import { expect, test } from '@playwright/test';
import { preview } from '../tests/fixtures/preview';

const image = { name: 'preview.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(preview, 'base64') };

test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', route => route.fulfill({
    contentType: 'application/javascript',
    body: "window.turnstile={render:()=> 'test-widget',getResponse:()=> 'XXXX.DUMMY.TOKEN.XXXX',reset:()=>{}};",
  }));
});

for (const width of [1280, 360]) {
  test(`creates, previews, plays, and deletes a real local link at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/hub/');
    await page.getByLabel('Viewer link', { exact: true }).fill('https://colmapview.opsiclear.com/?url=https%3A%2F%2Fdata.example%2Fmanifest.json#camera=43');
    await page.getByLabel('Title', { exact: true }).fill('Example reconstruction');
    await page.getByLabel('Description (optional)').fill('Public metadata, private source permissions.');
    await page.getByLabel('Preview image', { exact: true }).setInputFiles(image);
    await expect(page.locator('#draft-preview')).toBeVisible();
    await page.getByRole('checkbox').check();
    let owner = '';
    let thumbnail = '';
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith('/hub/api/links')) {
        const body = request.postDataJSON();
        owner = body.managementSecret;
        thumbnail = body.thumbnailBase64;
      }
    });
    await page.getByRole('button', { name: 'Create link', exact: true }).click();
    await expect(page.locator('#result')).toBeVisible();
    const publicUrl = await page.locator('#public-link').getAttribute('href');
    expect(owner).toHaveLength(43);
    expect(Buffer.from(thumbnail, 'base64').length).toBeLessThanOrEqual(65536);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`created-${width}.png`) });
    await page.goto(publicUrl!);
    await expect(page.getByRole('heading', { name: 'Example reconstruction', exact: true })).toBeVisible();
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
    expect(await page.locator('#player img').evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([600, 315]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.route('https://colmapview.opsiclear.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Interactive viewer fixture</h1>' }));
    await page.getByRole('button', { name: 'Play 3D', exact: true }).click();
    const frame = page.locator('iframe');
    await expect(frame).toBeVisible();
    const embed = new URL((await frame.getAttribute('src'))!);
    expect(embed.searchParams.get('embed')).toBe('1');
    expect(embed.hash).toBe('#camera=43');
    const id = new URL(publicUrl!).pathname.split('/').at(-1)!;
    await page.goto(`/hub/manage/${id}#${owner}`);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Delete link', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Link deleted.');
    expect((await page.request.get(publicUrl!)).status()).toBe(404);
    expect((await page.request.get(`${publicUrl}/preview.jpg`)).status()).toBe(404);
    expect(errors).toEqual([]);
  });
}

test('long titles and links stay within a narrow card, and management keys never enter public URLs', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/hub/');
  await page.getByLabel('Viewer link', { exact: true }).fill('https://colmapview.github.io/latest/?url=https%3A%2F%2Fdata.example%2Fmanifest.json');
  await page.getByLabel('Title', { exact: true }).fill('A'.repeat(120));
  await page.getByLabel('Preview image', { exact: true }).setInputFiles(image);
  await page.getByRole('checkbox').check();
  const submitted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/hub/api/links'));
  await page.getByRole('button', { name: 'Create link', exact: true }).click();
  await expect(page.locator('#result')).toBeVisible();
  const link = (await page.locator('#public-link').getAttribute('href'))!;
  expect(new URL(link).hash).toBe('');
  await page.goto(link);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const id = new URL(link).pathname.split('/').at(-1)!;
  const owner = (await submitted).postDataJSON().managementSecret;
  const deleted = await page.request.delete(`/hub/api/links/${id}`, { headers: { Origin: 'http://localhost:5201', Authorization: `Bearer ${owner}` } });
  expect(deleted.status()).toBe(204);
});
