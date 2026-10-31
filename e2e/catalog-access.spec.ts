import { expect, test } from '@playwright/test';

test('StandardSowbelly serves the matching photo/model pair while retaining points and Gaussians', async ({ page }) => {
  const opened = await page.request.get('/hub/open/data-7e77fe0f4355b9f36e463c8c', { maxRedirects: 0 });
  expect(opened.status()).toBe(302);
  const target = new URL(opened.headers().location).searchParams.get('url');
  expect(target).toMatch(/\/manifests\/[a-f0-9]{64}\.manifest\.json$/);
  const response = await page.request.get(new URL(target!).pathname);
  expect(response.status()).toBe(200);
  const manifest = await response.json();
  expect(manifest.version).toBe(2);
  expect(manifest.files.cameras).toContain('/anchored/solve/t2/sparse/0/cameras.bin');
  expect(manifest.files.images).toContain('/anchored/solve/t2/sparse/0/images.bin');
  expect(manifest.files.points3D).toContain('/anchored/undistorted/test/sparse/points3D.bin');
  expect(manifest.mediaArchives).toEqual([{
    url: 'https://huggingface.co/datasets/ChamudithaJay/PASLCD/resolve/aef858feb483dd81104fbb5232a8c98fbf4d3fcc/PASLCD_online.zip',
    bytes: 13226586599, mountPath: 'images', stripPrefix: 'PASLCD/Instance_1/Pots/inference_scene/images', role: 'images',
  }]);
  expect(manifest.splats).toHaveLength(24);
});

test('reviewed public gated sources show login placeholders and keep authenticated viewer launches', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json();
  const source = index.sources.find((item: { sourceId: string }) => item.sourceId === 'hf:Bluefish2333/ScannetPoseRefine');
  expect(source).toMatchObject({ access: 'gated', gatedPublicListing: true });
  const result = await (await page.request.get(`/hub/datasets/api/entries?dataset=${source.id}&q=scene0000_00`)).json();
  expect(result.total).toBe(1);
  expect(result.entries[0]).toMatchObject({ access: 'gated', hasViewer: true });
  const original = await page.request.get('/hub/open/data-93580dd2921e94e0c8d2e4e6', { maxRedirects: 0 });
  expect(original.status()).toBe(302);
  const launchUrl = new URL(original.headers().location, 'https://colmapview.opsiclear.com').searchParams.get('url');
  expect(launchUrl).toMatch(/\.manifest\.json$/);
  const launch = await (await page.request.get(new URL(launchUrl!).pathname)).json();
  expect(launch.access).toEqual([{ provider: 'huggingface', repository: 'Bluefish2333/ScannetPoseRefine', requirement: 'gated' }]);
  expect(launch.files.cameras).toContain('/scene0000_00/sparse/init/cameras.bin');
  const metadata = await page.request.get('/hub/datasets/individual/sources/hf-bluefish2333-scannetposerefine-2aaaa366183a.json');
  expect(metadata.status()).toBe(200);
  await page.goto(`/hub/?dataset=${source.id}&q=scene0000_00`);
  await expect(page.locator('.dataset-card')).toHaveCount(1);
  await expect(page.locator('.dataset-preview-placeholder')).toContainText('Login required');
  await expect(page.locator('.dataset-review')).toHaveText('Gated · HF login required');
});

test('the Gaussian scene filter returns the same kind and count reported by its cards', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json();
  const result = await (await page.request.get('/hub/datasets/api/entries?kind=Gaussian+scene')).json();
  expect(result.total).toBe(index.kinds['Gaussian scene']);
  expect(result.total).toBeGreaterThan(0);
  expect(result.entries.every((entry: { itemKind: string }) => entry.itemKind === 'Gaussian scene')).toBe(true);
  await page.goto('/hub/?kind=Gaussian+scene');
  await expect(page.locator('select[name="kind"]')).toHaveValue('Gaussian scene');
});

test('feed modes are seeded, paginated and respect collection balance or chronology', async ({ page }) => {
  for (const sort of ['discover', 'random', 'new']) {
    const firstUrl = `/hub/datasets/api/entries?sort=${sort}&seed=12345678`;
    const first = await (await page.request.get(firstUrl)).json();
    const repeat = await (await page.request.get(firstUrl)).json();
    const second = await (await page.request.get(firstUrl + '&page=2')).json();
    expect(first.feed).toEqual({ mode: sort, seed: '12345678' });
    expect(first.entries.map((entry: { id: string }) => entry.id)).toEqual(repeat.entries.map((entry: { id: string }) => entry.id));
    const ids: string[] = [...first.entries, ...second.entries].map((entry: { id: string }) => entry.id);
    expect(new Set(ids).size).toBe(48);
    if (sort === 'new') {
      // A newly published collection may own the entire newest cohort. Verify
      // dates against public metadata instead of requiring unrelated older data.
      const feed = await (await page.request.get('/hub/datasets/individual/feed.json')).json();
      const shards = new Map(await Promise.all([...new Set(ids.map(id => id.slice(5, 7)))].map(async shard =>
        [shard, await (await page.request.get(`/hub/datasets/individual/ids/${shard}.json`)).json()] as const)));
      const days = ids.map(id => feed.rows[shards.get(id.slice(5, 7))[id]][2]);
      expect(days[0]).toBe(Math.max(...feed.rows.map((row: number[]) => row[2])));
      expect(days).toEqual([...days].sort((a, b) => b - a));
    } else {
      expect(new Set(first.entries.slice(0, 20).map((entry: { dataset: { id: string } }) => entry.dataset.id)).size).toBeGreaterThanOrEqual(10);
    }
    expect(first.entries.every((entry: { hasViewer: boolean }) => entry.hasViewer)).toBe(true);
  }
  const cameras = await (await page.request.get('/hub/datasets/api/entries?kind=Cameras+and+poses&data=cameras&sort=random&seed=12345678')).json();
  expect(cameras.total).toBeGreaterThan(0);
  expect(cameras.entries.every((entry: { sceneStats: { points: number } }) => entry.sceneStats.points === 0)).toBe(true);
});

test('fresh visits get independent orders and Back keeps each visit', async ({ page }) => {
  const path = '/hub/?kind=COLMAP+reconstruction';
  await page.goto(path);
  await expect.poll(() => page.evaluate(() => history.state?.colmapviewFeedSeed)).toMatch(/^[a-f0-9]{16}$/);
  await expect(page).toHaveURL(new URL(path, page.url()).href);
  const firstSeed = await page.evaluate(() => history.state.colmapviewFeedSeed);
  await page.locator('#catalog-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
  const firstIds = await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')));
  await page.goto('/hub/entry/' + firstIds[0]);
  await page.goto(path);
  await expect.poll(() => page.evaluate(() => history.state?.colmapviewFeedSeed)).toMatch(/^[a-f0-9]{16}$/);
  await expect(page).toHaveURL(new URL(path, page.url()).href);
  expect(await page.evaluate(() => history.state.colmapviewFeedSeed)).not.toBe(firstSeed);
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  expect(await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')))).not.toEqual(firstIds.slice(0, 24));
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Dataset information', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
  expect(await page.evaluate(() => history.state.colmapviewFeedSeed)).toBe(firstSeed);
  expect(new URL(page.url()).searchParams.has('seed')).toBe(false);
  expect(await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')))).toEqual(firstIds);
});

test('scrolling appends scenes without duplicates and shuffle preserves active filters', async ({ page }) => {
  await page.goto('/hub/?sort=random&seed=12345678&kind=COLMAP+reconstruction');
  await expect(page).toHaveURL(/sort=random&kind=COLMAP\+reconstruction$/);
  expect(await page.evaluate(() => history.state.colmapviewFeedSeed)).toBe('12345678');
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  const first = await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')));
  await page.locator('#catalog-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
  const all = await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')));
  expect(all.slice(0, 24)).toEqual(first);
  expect(new Set(all).size).toBe(48);
  await page.locator('#catalog-shuffle').click();
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  await expect(page.getByLabel('Type', { exact: true })).toHaveValue('COLMAP reconstruction');
  await expect(page.getByLabel('Feed', { exact: true })).toHaveValue('random');
  const shuffledSeed = await page.evaluate(() => history.state.colmapviewFeedSeed);
  expect(shuffledSeed).not.toBe('12345678');
  expect(new URL(page.url()).searchParams.has('seed')).toBe(false);
  const shuffled = await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')));
  expect(shuffled).not.toEqual(first);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.goBack();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
  expect(await page.evaluate(() => history.state.colmapviewFeedSeed)).toBe('12345678');
  expect(await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')))).toEqual(all);
  await page.goForward();
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  expect(await page.evaluate(() => history.state.colmapviewFeedSeed)).toBe(shuffledSeed);
  expect(await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')))).toEqual(shuffled);
});

for (const failures of [1, 2]) test(failures === 1 ? 'automatic loading recovers from one transient failure' : 'persistent automatic loading failure pauses until an explicit retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/hub/datasets/api/entries?**', async route => {
    if (new URL(route.request().url()).searchParams.get('page') === '2' && ++attempts <= failures) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary failure' }) });
    } else await route.continue();
  });
  await page.goto('/hub/?sort=random&seed=12345678');
  await page.locator('#catalog-sentinel').scrollIntoViewIfNeeded();
  if (failures === 1) {
    await expect(page.locator('.dataset-card')).toHaveCount(48);
    expect(attempts).toBe(2);
    return;
  }
  await expect(page.locator('#catalog-status')).toContainText('Could not load more');
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  await page.waitForTimeout(300);
  expect(attempts).toBe(2);
  await page.getByRole('button', { name: 'Retry loading more', exact: true }).click();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
});

test('reading catalog notes defers an in-flight append until the notes close', async ({ page }) => {
  let release: () => void = () => {};
  let requested: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/hub/datasets/api/entries?**', async route => {
    if (new URL(route.request().url()).searchParams.get('page') !== '2') return route.continue();
    const response = await route.fetch();
    requested();
    await held;
    await route.fulfill({ response });
  });
  await page.goto('/hub/?sort=random&seed=12345678');
  await page.locator('#catalog-sentinel').scrollIntoViewIfNeeded();
  await started;
  await page.locator('.catalog-notes > summary').click();
  const response = page.waitForResponse(value => new URL(value.url()).searchParams.get('page') === '2');
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page.locator('.catalog-totals')).toBeVisible();
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  await page.locator('.catalog-notes > summary').click();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
});

test('duplicate response pages never append repeated cards', async ({ page }) => {
  const original = await (await page.request.get('/hub/datasets/api/entries?sort=random&seed=12345678')).json();
  await page.route('**/hub/datasets/api/entries?**', async route => {
    if (new URL(route.request().url()).searchParams.get('page') === '2') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...original, page: 2 }) });
    } else await route.continue();
  });
  await page.goto('/hub/?sort=random&seed=12345678');
  await page.locator('#catalog-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('#catalog-status')).toContainText('catalog changed');
  await expect(page.locator('.dataset-card')).toHaveCount(24);
});

for (const width of [1280, 390]) test(`Back restores the visible scene and refresh reshuffles at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('feed-return-navigation-fixture') !== '1') return;
    const observer = new MutationObserver(() => {
      if (document.querySelectorAll('.dataset-card').length < 48) return;
      observer.disconnect();
      // Exercise a traversal event before restored layout reaches its first frame.
      dispatchEvent(new PopStateEvent('popstate'));
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.route('**/s/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Viewer navigation fixture</h1>' }));
  await page.goto('/hub/?sort=random&seed=12345678');
  await page.locator('#catalog-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
  const ids = await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')));
  const card = page.locator('.dataset-card').nth(30);
  await card.scrollIntoViewIfNeeded();
  const identity = await card.getAttribute('data-entry-id');
  await page.evaluate(() => {
    // Deferred layout can move the selected card outside the viewport between
    // activation and pagehide. The clicked scene must still be the return anchor.
    document.querySelector('#catalog-results')!.addEventListener('click', () => scrollTo(0, 0), { capture: true, once: true });
  });
  await card.locator('.dataset-open').click();
  await expect(page.getByRole('heading', { name: 'Viewer navigation fixture' })).toBeVisible();
  const anchor = await page.evaluate(() => JSON.parse(sessionStorage.getItem('colmapview-scene-feed-v1') || '[]')[0]?.anchor);
  expect(anchor.id).toBe(identity);
  await page.evaluate(() => sessionStorage.setItem('feed-return-navigation-fixture', '1'));
  await page.goBack();
  // A denser viewport can prefetch another page while returning to the anchor.
  // The previously seen order and selected scene must survive that append.
  await expect.poll(() => page.locator('.dataset-card').count()).toBeGreaterThanOrEqual(ids.length);
  const returnedIds = await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')));
  expect(returnedIds.slice(0, ids.length)).toEqual(ids);
  expect(new Set(returnedIds).size).toBe(returnedIds.length);
  await expect(page.locator(`[data-entry-id="${identity}"]`)).toBeInViewport();
  expect(await page.evaluate(() => history.scrollRestoration)).toBe('manual');
  await page.reload();
  await expect.poll(() => page.evaluate(() => history.state?.colmapviewFeedSeed)).not.toBe('12345678');
  expect(new URL(page.url()).searchParams.has('seed')).toBe(false);
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  expect(await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')))).not.toEqual(ids.slice(0, 24));
  await expect(page.getByLabel('Feed', { exact: true })).toHaveValue('random');
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('a catalog update restarts the feed instead of mixing generations', async ({ page }) => {
  const url = '/hub/datasets/api/entries?sort=random&seed=12345678';
  const first = await (await page.request.get(url)).json();
  const next = await (await page.request.get(url + '&page=2')).json();
  let refreshed = false;
  await page.route('**/hub/datasets/api/entries?**', async route => {
    const pageNumber = new URL(route.request().url()).searchParams.get('page');
    if (pageNumber !== '2') refreshed = true;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...(pageNumber === '2' ? next : first), generation: 'updated-catalog-fixture' }) });
  });
  await page.goto('/hub/?sort=random&seed=12345678');
  await page.locator('#catalog-sentinel').scrollIntoViewIfNeeded();
  await expect.poll(() => refreshed).toBe(true);
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  expect(await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id'))))
    .toEqual(first.entries.map((entry: { id: string }) => entry.id));
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

for (const action of ['navigate', 'close']) test(`pending searches retain open metadata until ${action}`, async ({ page }) => {
  await page.goto('/hub/?sort=random&seed=12345678');
  const initial = JSON.parse((await page.locator('#catalog-initial-data').textContent())!);
  const identity = initial.entries[0].id;
  let releaseSearch: (() => void) | undefined;
  const held = new Promise<void>(resolve => { releaseSearch = resolve; });
  let requested = false;
  await page.route('**/hub/datasets/api/entries?**', async route => {
    requested = true;
    await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...initial,
      entries: initial.entries.slice(0, 1), total: 1, pages: 1, page: 1, dataset: null }) });
  });
  await page.getByRole('searchbox', { name: 'Search datasets' }).fill('pending');
  const first = page.locator('.dataset-card').first();
  await first.locator('.dataset-info').click();
  await expect.poll(() => requested).toBe(true);
  const completed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/hub/datasets/api/entries'));
  releaseSearch!();
  await (await completed).finished();
  // Let the completed fetch reach the renderer while the dialog is still open.
  await page.waitForTimeout(150);
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await expect(page.locator('.dataset-card')).toHaveCount(24);
  if (action === 'navigate') {
    await panel.getByRole('link', { name: 'Full metadata', exact: true }).click();
    expect(new URL(page.url()).pathname).toBe('/hub/entry/' + identity);
  } else {
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.dataset-card')).toHaveCount(1);
    await expect(page.locator('.dataset-card .dataset-info')).toBeFocused();
    expect(new URL(page.url()).searchParams.get('q')).toBe('pending');
  }
});

for (const malformed of ['short page', 'duplicate within page']) test(`rejects a ${malformed} without losing current cards`, async ({ page }) => {
  const next = await (await page.request.get('/hub/datasets/api/entries?sort=random&seed=12345678&page=2')).json();
  if (malformed === 'short page') next.entries.pop();
  else next.entries[1] = next.entries[0];
  await page.route('**/hub/datasets/api/entries?**', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(next) });
  });
  await page.goto('/hub/?sort=random&seed=12345678');
  await page.locator('#catalog-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('#catalog-status')).toContainText('incomplete metadata');
  await expect(page.locator('.dataset-card')).toHaveCount(24);
});

test('blocked storage and unavailable intersection observers retain manual pagination', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', { value: undefined });
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage blocked'); } });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/hub/?sort=random&seed=12345678');
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
  const first = await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')));
  const identity = first[0];
  await page.goto('/hub/entry/' + identity);
  await page.goBack();
  await expect.poll(() => page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')))).toEqual(first.slice(0, 24));
  expect(await page.evaluate(() => history.state.colmapviewFeedSeed)).toBe('12345678');
  expect(new URL(page.url()).searchParams.has('seed')).toBe(false);
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.locator('.dataset-card')).toHaveCount(48);
  expect(await page.locator('.dataset-card').evaluateAll(cards => cards.map(card => card.getAttribute('data-entry-id')))).toEqual(first);
  expect(errors).toEqual([]);
});

test('a finite filtered feed stops automatically and retains source metadata panels', async ({ page }) => {
  await page.goto('/hub/?q=large_overlap+basketball+sparse_native');
  await expect(page.locator('.dataset-card')).toHaveCount(1);
  await expect(page.locator('#catalog-end')).toBeVisible();
  await expect(page.locator('#catalog-more')).toBeHidden();
  await page.locator('.dataset-info').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Dataset information');
});

test('retired collection pages open the current scene browser and retain source identity', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json();
  expect(index.sources.length).toBeGreaterThan(0);
  for (const source of index.sources) {
    const response = await page.request.get(`/hub/datasets/${source.id}`, { maxRedirects: 0 });
    expect(response.status(), source.id).toBe(308);
    const target = new URL(response.headers().location);
    expect(target.pathname).toBe('/hub/');
    expect(target.searchParams.get('dataset')).toBe(source.id);
  }
  const source = index.sources[0];
  for (const path of ['/hub/datasets/collections', '/hub/datasets/collections.html', '/hub/datasets/collection-page-2',
    '/hub/datasets/page-2.html', `/hub/datasets/${source.id}.html`, `/hub/datasets/${source.id}/`]) {
    const response = await page.request.get(`${path}?licenseCategory=commercial&page=3`, { maxRedirects: 0 });
    expect(response.status(), path).toBe(308);
    const target = new URL(response.headers().location);
    expect(target.searchParams.get('licenseCategory')).toBe('commercial');
    expect(target.searchParams.has('page')).toBe(false);
  }
  await page.goto(`/hub/datasets/${source.id}`);
  await expect(page.getByRole('heading', { name: 'Public datasets', exact: true })).toBeVisible();
  await expect(page.getByLabel('Collection', { exact: true })).toHaveValue(source.id);
  await expect(page.locator('#dataset-selection')).toContainText(source.label);
  await expect(page.locator('a[href*="/datasets/collections"], a[href*="/datasets/collection-page-"]')).toHaveCount(0);
  expect((await page.request.get(`/hub/datasets/individual/sources/${source.id}.json`)).status()).toBe(200);
  expect((await page.request.get('/hub/assets/catalog.js')).status()).toBe(404);
});
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const id = (source: string, kind: string, path: string, archive = '') =>
  'data-' + createHash('sha256').update([source, kind, archive, path].join('\0')).digest('hex').slice(0, 24);
const gatedSource = 'hf-akashskypatel-neurcross-labels-69b128482886';
const gatedPath = 'generated-labels/kaggle-balraj98-modelnet40-princeton-3d-object-dataset/airplane_0048-a83c7315ee13/input/airplane_0048-0138384160df.ply';
const gatedId = id('hf:akashskypatel/NeurCross-Labels', 'ply', gatedPath);

test('the reported gated PLY is no longer published', async ({ page }) => {
  const providerRequests: string[] = [];
  page.on('request', request => { if (new URL(request.url()).hostname === 'huggingface.co') providerRequests.push(request.url()); });
  await page.setViewportSize({ width: 360, height: 900 });
  expect((await page.goto(`/hub/entry/${gatedId}`))!.status()).toBe(404);
  await expect(page.locator('main')).toContainText('Dataset entry not found.');
  await expect(page.locator('main')).not.toContainText(gatedPath);
  await expect(page.getByRole('link', { name: /Try in ColmapView|Try listed model|Dataset URL/ })).toHaveCount(0);
  expect(providerRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('removed gated collections have no page, search result or dataset option', async ({ page }) => {
  expect((await page.goto(`/hub/datasets/${gatedSource}`))!.status()).toBe(404);
  await page.goto(`/hub/?dataset=${gatedSource}`);
  await expect(page.locator('#catalog-count')).toHaveText('No matches');
  await expect(page.locator(`option[value="${gatedSource}"]`)).toHaveCount(0);
  const response = await page.request.get(`/hub/datasets/api/entries?dataset=${gatedSource}`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ total: 0, entries: [], dataset: null });
  expect((await page.request.get(`/hub/datasets/individual/sources/${gatedSource}.json`)).status()).toBe(404);
});

test('extraction-only collections are removed from pages and public metadata', async ({ page }) => {
  const source = 'hf-imchuling-3d-room-collections-bcd1917cdfaa';
  expect((await page.goto(`/hub/datasets/${source}`))!.status()).toBe(404);
  expect((await page.request.get(`/hub/datasets/individual/sources/${source}.json`)).status()).toBe(404);
  const response = await page.request.get(`/hub/datasets/api/entries?dataset=${source}`);
  expect(await response.json()).toMatchObject({ total: 0, entries: [], dataset: null });
});

test('standalone extracted members and their nonopening collections are absent', async ({ page }) => {
  const member = id('hf:paroj/ycbev', 'ply', 'models_eval/obj_000001.ply', 'ycbv_models.zip');
  expect((await page.goto(`/hub/entry/${member}`))!.status()).toBe(404);
  expect((await page.goto('/hub/datasets/hf-paroj-ycbev-sd-c89da44da829'))!.status()).toBe(404);
});

test('a checked standalone file does not keep a collection without loadable named scenes published', async ({ page }) => {
  const audit = JSON.parse(readFileSync('data/dataset-audit.json', 'utf8')) as { results: { sourceId: string; loadUrl?: string; gated?: boolean | string; viewerImport?: { status: string } }[] };
  const catalog = JSON.parse(readFileSync('data/catalog.json', 'utf8')) as { entries: { id: string; sourceId: string }[] };
  const published = JSON.parse(readFileSync('public/hub/datasets/catalog.json', 'utf8')) as typeof catalog;
  const retained = new Set(published.entries.map(entry => entry.sourceId));
  const sample = audit.results.find(row => row.sourceId.startsWith('hf:') && row.loadUrl?.endsWith('.ply') && !row.gated
    && row.viewerImport?.status === 'passed' && !retained.has(row.sourceId) && catalog.entries.some(entry => entry.sourceId === row.sourceId));
  expect(sample).toBeTruthy();
  const collection = catalog.entries.find(entry => entry.sourceId === sample!.sourceId)!;
  expect((await page.goto(`/hub/datasets/${collection.id}`))!.status()).toBe(404);
  expect((await page.request.get(`/hub/datasets/individual/sources/${collection.id}.json`)).status()).toBe(404);
});

test('reviewed missing models and unsupported spherical cameras have no public scenes or collection pages', async ({ page }) => {
  for (const source of ['hf-perry233-astrovision-data-a1cdfc4cd9d3', 'hf-siminkou-dyomni-9f8f10c760ba']) {
    expect((await page.goto(`/hub/datasets/${source}`))!.status()).toBe(404);
    const response = await page.request.get(`/hub/datasets/api/entries?dataset=${source}`);
    expect(await response.json()).toMatchObject({ total: 0, entries: [], dataset: null });
    expect((await page.request.get(`/hub/datasets/individual/sources/${source}.json`)).status()).toBe(404);
  }
  const removed = id('hf:SiminKou/DyOmni', 'colmap', 'Ayutthaya/output_dir/colmap');
  expect((await page.goto(`/hub/entry/${removed}`))!.status()).toBe(404);
  expect((await page.request.get(`/hub/open/${removed}`, { maxRedirects: 0 })).status()).toBe(404);
});

test('Hourglass and other standalone file names are absent from scene browsing', async ({ page }) => {
  const hourglass = id('hf:adfa5456/FastRobustICP', 'stl', 'data/Hourglass.stl');
  expect((await page.goto(`/hub/entry/${hourglass}`))!.status()).toBe(404);
  await page.goto('/hub/?q=Hourglass');
  await expect(page.locator('#catalog-count')).toHaveText('No matches');
  const response = await page.request.get('/hub/datasets/api/entries?q=Hourglass');
  expect(await response.json()).toMatchObject({ unit: 'named_scene', total: 0, entries: [] });
});

test('native layouts remain listed with optional or missing photographs', async ({ page }) => {
  for (const [source, count] of [['hf-opsiclear-ngs-19c25258f77b', 259], ['hf-dororo99-ours-waymo-armgs-dc9c063eca1c', 11]] as const) {
    const response = await page.request.get(`/hub/datasets/api/entries?dataset=${source}`);
    const data = await response.json() as { total: number; entries: { id: string; openUrl: string; description: string }[] };
    expect(data.total).toBe(count);
    const target = await page.request.get(data.entries[0].openUrl, { maxRedirects: 0 });
    expect(target.status()).toBe(302);
    expect(new URL(target.headers().location).searchParams.get('url')).not.toMatch(/\.ply$/);
    await page.goto(`/hub/entry/${data.entries[0].id}`);
    await expect(page.locator('main')).toContainText('Original photographs');
    await expect(page.locator('main')).toContainText('Native layout check');
    if (count === 11) {
      await expect(page.locator('main')).toContainText('Not included by publisher');
      expect(data.entries.every(row => row.description.includes('does not include the original photographs'))).toBe(true);
    }
  }
});

test('complete-export evidence stays scoped while other model layouts remain loadable', async ({ page }) => {
  const policy = JSON.parse(readFileSync('data/verified-scenes.json', 'utf8')) as {
    scenes: { sourceId: string; kind: string; path: string; viewerUrl: string; export?: string; counts: { images: number } }[] };
  const indexResponse = await page.request.get('/hub/datasets/individual/index.json');
  const index = await indexResponse.json() as { total: number; generation: string };
  const checks = await page.request.get('/hub/datasets/individual/verified-scenes.json');
  const published = await checks.json() as { generation: string; scenes: typeof policy.scenes };
  const sortScenes = (scenes: typeof policy.scenes) => scenes.toSorted((a, b) => id(a.sourceId, a.kind, a.path).localeCompare(id(b.sourceId, b.kind, b.path)));
  expect(published.generation).toBe(index.generation);
  expect(sortScenes(published.scenes)).toEqual(sortScenes(policy.scenes));
  const response = await page.request.get('/hub/datasets/api/entries?status=Cameras%20%2B%20photos%20verified');
  const data = await response.json() as { total: number; entries: { id: string; shareName: string; statusLabel: string; delivery: string; hasViewer: boolean }[] };
  expect(index.total).toBeGreaterThan(policy.scenes.length);
  const completePhotoExports = policy.scenes.filter(scene => scene.export !== 'colmap_model');
  expect(completePhotoExports).toHaveLength(4);
  const reviews = await (await page.request.get('/hub/datasets/api/entries?status=Calibration+needs+review')).json() as typeof data;
  expect(reviews.total).toBe(9);
  expect(reviews.entries.every(scene => scene.hasViewer && scene.statusLabel === 'Calibration needs review')).toBe(true);
  const reviewedIds = new Set(reviews.entries.map(scene => scene.id));
  expect(data.total).toBe(completePhotoExports.filter(scene => !reviewedIds.has(id(scene.sourceId, scene.kind, scene.path))).length);
  expect(data.entries.every(scene => scene.hasViewer && scene.statusLabel === 'Cameras + photos verified' && scene.delivery === 'browser_readable')).toBe(true);
  for (const scene of completePhotoExports) {
    const sceneId = id(scene.sourceId, scene.kind, scene.path);
    expect([...data.entries, ...reviews.entries].some(row => row.id === sceneId)).toBe(true);
    const open = await page.request.get(`/hub/open/${sceneId}`, { maxRedirects: 0 });
    expect(open.status()).toBe(302);
    expect(open.headers().location).toBe(scene.viewerUrl);
    await page.goto(`/hub/entry/${sceneId}`);
    const name = [...data.entries, ...reviews.entries].find(row => row.id === sceneId)!.shareName;
    await expect(page.getByRole('link', { name: 'Try in ColmapView' })).toHaveAttribute('href', `/s/${name}`);
    await expect(page.locator('main')).toContainText('Verified original photographs');
    await expect(page.locator('main')).toContainText(`${scene.counts.images} posed original photographs`);
    if (reviewedIds.has(sceneId)) {
      await expect(page.locator('main')).toContainText('Calibration review');
      await expect(page.locator('main')).toContainText('Pixel-aspect calibration is unverified');
    }
  }
  const catalogResponse = await page.request.get('/hub/datasets/catalog.json');
  const catalog = await catalogResponse.json() as { entries: { id: string; viewerUrl?: string; dataUrl: string; sourceUrl: string }[] };
  expect(catalog.entries.length).toBeGreaterThan(3);
  for (const source of catalog.entries.slice(0, 3)) {
    expect(source.viewerUrl).toBeUndefined();
    expect(source.dataUrl).toBe(source.sourceUrl);
    await page.goto(`/hub/datasets/${source.id}`);
    await expect(page.getByRole('link', { name: 'Try in ColmapView' })).toHaveCount(0);
    await expect(page.getByLabel('Collection', { exact: true })).toHaveValue(source.id);
  }
});

test('a checked companion PLY cannot qualify a scene or collection for publication', async ({ page }) => {
  for (const sample of [
    { source: 'hf:Dororo99/Ours_Waymo_ADGS', collection: 'hf-dororo99-ours-waymo-adgs-b00d3434f2f7', path: '9747453753779078631_940_000_960_000' },
  ]) {
    const response = await page.request.get(`/hub/datasets/api/entries?dataset=${sample.collection}`);
    expect(await response.json()).toMatchObject({ total: 0, entries: [], dataset: null });
    const entry = id(sample.source, 'camera-scene', sample.path);
    expect((await page.goto(`/hub/entry/${entry}`))!.status()).toBe(404);
    expect((await page.request.get(`/hub/open/${entry}`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await page.request.get(`/hub/datasets/${sample.collection}`)).status()).toBe(404);
    expect((await page.request.get(`/hub/datasets/individual/sources/${sample.collection}.json`)).status()).toBe(404);
  }
});

test('camera metadata opens its checked camera source and camera-only scenes retain optional photo prefixes', async ({ page }) => {
  const policy = JSON.parse(readFileSync('data/verified-scenes.json', 'utf8')) as {
    scenes: { sourceId: string; kind: string; path: string; viewerUrl: string; export?: string }[] };
  const manifests = JSON.parse(readFileSync('data/scene-manifests.json','utf8')) as {scenes:{sourceId:string;kind:string;path:string}[]};
  const overridden = new Set(manifests.scenes.map(scene=>id(scene.sourceId,scene.kind,scene.path)));
  const modelExports = policy.scenes.filter(scene => scene.export === 'colmap_model' && !overridden.has(id(scene.sourceId,scene.kind,scene.path)));
  expect(modelExports.length).toBeGreaterThan(0);
  const result = await (await page.request.get('/hub/datasets/api/entries?status=Camera%20model%20export%20checked')).json();
  expect(result.total).toBe(modelExports.length);
  expect(result.entries.every((entry: { hasViewer: boolean; photoStatus: string }) => entry.hasViewer && entry.photoStatus !== 'complete_export_checked')).toBe(true);
  const scene = modelExports.find(scene => scene.sourceId === 'hf:HaoqinHong/Physics-Informed-Deformable-Gaussian-Splatting')!;
  const entry = id(scene.sourceId, scene.kind, scene.path);
  const open = await page.request.get(`/hub/open/${entry}`, { maxRedirects: 0 });
  expect(open.status()).toBe(302);
  expect(open.headers().location).toBe(scene.viewerUrl);
  expect(new URL(scene.viewerUrl).searchParams.get('url')).toMatch(/dry_ice\/transforms.*\.json$/);
  await page.goto(`/hub/entry/${entry}`);
  await expect(page.locator('main')).toContainText('COLMAP model export SHA-256');
  await expect(page.locator('main')).not.toContainText('Verified original photographs');
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('97');
  await expect(page.locator('[data-stat="points"]')).toHaveText('100,000');
  const cameraOnly = id('hf:Bugjudger/HDR_Pretrain', 'cameras', 'scenes/102343992/sparse/0');
  const target = await page.request.get(`/hub/open/${cameraOnly}`, { maxRedirects: 0 });
  expect(target.status()).toBe(302);
  const url = new URL(target.headers().location).searchParams.get('url')!;
  const manifest = await (await page.request.get(url.replace('https://colmapview.opsiclear.com', ''))).json();
  expect(Object.keys(manifest.files).sort()).toEqual(['cameras', 'images']);
  expect(manifest.imagesPath).toContain('/scenes/102343992/images/');
  expect(manifest.baseUrl).toBe('https://colmapview.opsiclear.com/hub/datasets/individual/manifests/');
  await page.goto(`/hub/entry/${cameraOnly}`);
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('35');
  await expect(page.locator('[data-stat="points"]')).toHaveText('0');
});
