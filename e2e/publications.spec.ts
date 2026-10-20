import { expect, test } from '@playwright/test';
import { preview } from '../tests/fixtures/preview';

const id = 'HappyTree-LAAAAAAAAAAAAAAAA';
for (const width of [1280, 360]) {
  test(`renders a shared asset with safe metadata in the existing catalog at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/hub/api/publications', route => route.fulfill({ json: { entries: [{ id, title: 'Shared <script>scene</script>',
      description: 'A public reconstruction.', viewerUrl: 'https://colmapview.opsiclear.com/?url=https://huggingface.co/datasets/owner/scene',
      license: { id: 'cc-by-4.0', name: 'CC BY 4.0' }, createdAt: new Date().toISOString(), verification: { method: 'hf_colmap_headers', checkedAt: new Date().toISOString() } }] } }));
    await page.route(`**/hub/${id}/preview.jpg`, route => route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(preview, 'base64') }));
    await page.goto('/hub/');
    const section = page.getByRole('region', { name: 'Shared on Hub', exact: true });
    await expect(section.getByRole('link', { name: 'Open in viewer: Shared <script>scene</script>' })).toHaveAttribute('href', `/s/${id}`);
    await expect(section.locator('script')).toHaveCount(0);
    await section.getByRole('button', { name: 'Metadata for Shared <script>scene</script>' }).click();
    const panel = page.getByRole('dialog', { name: 'Metadata for Shared <script>scene</script>' });
    await expect(panel.getByText('A public reconstruction.')).toBeVisible();
    await expect(panel.getByText('License: CC BY 4.0')).toBeVisible();
    await expect(panel.getByText('License category: Commercial use', { exact: true })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Dataset source ↗' })).toHaveAttribute('href', 'https://huggingface.co/datasets/owner/scene');
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`hub-shared-${width}.png`), fullPage: false });
  });
}
