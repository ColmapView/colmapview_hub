import { expect, test } from '@playwright/test';
import { preview } from '../tests/fixtures/preview';

const id = 'HappyTree-LAAAAAAAAAAAAAAAA';
for (const width of [1280, 360]) {
  for (const github of [false, true]) {
    test(`renders a shared asset with safe metadata at ${width}px, github=${github}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route('**/hub/api/publications', route => route.fulfill({ json: { entries: [{ id, title: 'Shared <script>scene</script>',
        description: 'A public reconstruction.', viewerUrl: 'https://colmapview.opsiclear.com/?url=https://huggingface.co/datasets/owner/scene',
        license: { id: 'cc-by-4.0', name: 'CC BY 4.0' },
        assets: { format: 'folder', imageFormat: 'original', colmap: { files: 3, cameras: 4, points: 15 },
          images: 4, masks: 2, splats: 1, viewerSettings: false, preview: true },
        createdAt: new Date().toISOString(), verification: { method: 'hf_colmap_headers', checkedAt: new Date().toISOString() } }] } }));
      await page.route(`**/hub/${id}/preview.jpg`, route => route.fulfill({ contentType: 'image/jpeg', body: Buffer.from(preview, 'base64') }));
      await page.goto('/hub/' + (github ? '?viewerHost=github' : ''));
      const section = page.getByRole('region', { name: 'Shared on Hub', exact: true });
      await expect(section.getByRole('link', { name: 'Open in viewer: Shared <script>scene</script>' })).toHaveAttribute('href', `/s/${id}` + (github ? '?viewerHost=github' : ''));
      await expect(section.locator('script')).toHaveCount(0);
      await page.mouse.move(0, 0);
      const tags = section.locator('.dataset-card-tags');
      await expect(tags).toBeVisible();
      await expect(tags.locator('[data-asset="images"]')).toBeVisible();
      await expect(tags.locator('[data-asset="cameras"]')).toBeVisible();
      await expect(tags.locator('[data-asset="splats"]')).toHaveText('Gaussian candidates · listed');
      await expect(tags.getByText('Commercial use · CC BY 4.0', { exact: true })).toBeVisible();
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
}
