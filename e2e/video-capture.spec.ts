import { expect, test } from '@playwright/test';

for (const sample of [
  { id: 'data-92baac9828db4bc141448f90', dataset: 'hf-sebothetramp-mbzuai-campus-4d55353ba4ca', query: 'campus_nlp', type: 'moving_camera', label: 'Moving camera' },
  { id: 'data-7ab128e89d676305e079e729', dataset: 'hf-nyuvideolab-dancenet3d-51f2e5a86cec', query: 's6/BiancaGolden_Ocho', type: 'synchronized_multiview', label: 'Synchronized multi-view' },
]) {
  test(`video capture labels survive asynchronous filtering and full metadata: ${sample.type}`, async ({ page }) => {
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
