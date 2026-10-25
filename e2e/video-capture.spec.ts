import { expect, test } from '@playwright/test';

for (const sample of [
  { id: 'data-92baac9828db4bc141448f90', dataset: 'hf-sebothetramp-mbzuai-campus-4d55353ba4ca', query: 'campus_nlp', type: 'moving_camera', label: 'Moving camera' },
  { id: 'data-49bf5cfb99943b782333146d', dataset: 'hf-sebothetramp-mbzuai-campus-4d55353ba4ca', query: 'campus_knowledge_center', type: 'moving_camera', label: 'Moving camera' },
  { id: 'data-7ab128e89d676305e079e729', dataset: 'hf-nyuvideolab-dancenet3d-51f2e5a86cec', query: 's6/BiancaGolden_Ocho', type: 'synchronized_multiview', label: 'Synchronized multi-view' },
]) {
  test(`video capture labels survive asynchronous filtering and full metadata: ${sample.query}`, async ({ page }) => {
    await page.goto('/hub/datasets/');
    await page.locator('select[name="dataset"]').selectOption(sample.dataset);
    await page.locator('input[name="q"]').fill(sample.query);
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(sample.query);
    const card = page.locator(`[data-entry-id="${sample.id}"]`);
    await expect(card).toHaveCount(1);
    await expect(card.locator('.dataset-card-hover')).toContainText(sample.label);
    const result = await (await page.request.get(`/hub/datasets/api/entries?dataset=${sample.dataset}&q=${encodeURIComponent(sample.query)}`)).json();
    expect(result.entries.find((entry: { id: string }) => entry.id === sample.id)?.videoCapture).toBe(sample.type);
    await card.getByRole('button', { name: /^Metadata for / }).click();
    const metadata = card.getByRole('dialog');
    await expect(metadata.getByText(sample.label, { exact: true })).toBeVisible();
    await metadata.getByRole('link', { name: 'Full metadata', exact: true }).click();
    await expect(page.locator('main')).toContainText(sample.label);
    await expect(page.locator('main')).toContainText('Temporal scope');
  });
}

test('AblazeDowntown opens all 291 matched frames and uses a cached gallery preview', async ({ page }) => {
  let providerReads = 0;
  await page.route('https://huggingface.co/**', route => { providerReads++; return route.abort(); });
  await page.goto('/hub/datasets/?dataset=hf-sebothetramp-mbzuai-campus-4d55353ba4ca&q=campus_knowledge_center');
  const card = page.locator('[data-entry-id="data-49bf5cfb99943b782333146d"]');
  const image = card.locator('img');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', /\/thumbnails\/[a-f0-9]{64}\.jpg$/);
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(providerReads).toBe(0);
  const opened = await page.request.get('/hub/datasets/open/data-49bf5cfb99943b782333146d', { maxRedirects: 0 });
  expect(opened.status()).toBe(302);
  const manifestUrl = new URL(new URL(opened.headers().location).searchParams.get('url')!);
  const manifest = await (await page.request.get(manifestUrl.pathname)).json();
  expect(manifest.version).toBe(5);
  expect(Object.keys(manifest.videoImages)).toHaveLength(291);
  const bindings = Object.values(manifest.videoImages) as { url: string; frameIndex: number }[];
  expect(new Set(bindings.map(binding => binding.url)).size).toBe(6);
  expect(manifest.videoImages['campus_knowledge_center/cam00/000000_a.jpg'].frameIndex).toBe(7);
  expect(manifest.files.points3D).toContain('/campus_knowledge_center/0/points3D.bin');
});
