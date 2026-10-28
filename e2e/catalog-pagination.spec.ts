import { expect, test } from '@playwright/test';

test('the gallery continues past 480 scenes without repeating cards or stopping before the final page', async ({ page, request }) => {
  const ids = new Set<string>();
  let lastPage = 0;
  for (let number = 1; number <= 22; number++) {
    const response = await request.get(`/hub/datasets/api/entries?seed=12345678&page=${number}`);
    expect(response.status()).toBe(200);
    const data = await response.json() as { entries: { id: string }[]; page: number; pages: number; total: number };
    expect(data.page).toBe(number);
    expect(data.entries).toHaveLength(24);
    for (const entry of data.entries) { expect(ids.has(entry.id)).toBe(false); ids.add(entry.id); }
    lastPage = data.pages;
  }
  expect(ids.size).toBe(528);
  for (const sort of ['discover', 'random', 'new']) {
    for (const number of [20, 21, lastPage]) {
      const response = await request.get(`/hub/datasets/api/entries?seed=12345678&sort=${sort}&page=${number}`);
      expect(response.status()).toBe(200);
      const data = await response.json() as { entries: { id: string }[]; page: number; total: number };
      expect(data.page).toBe(number);
      expect(data.entries).toHaveLength(Math.min(24, data.total - (number - 1) * 24));
    }
  }
  await page.goto('/hub/?seed=12345678&page=20');
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  await page.locator('#catalog-more').click();
  await expect.poll(() => page.locator('.dataset-card').count()).toBeGreaterThanOrEqual(48);
  await expect(page.locator('#catalog-status')).not.toContainText('Could not load more');
});
