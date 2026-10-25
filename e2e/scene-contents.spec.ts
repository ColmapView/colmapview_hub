import { expect, test } from '@playwright/test';

test('OcularBell adds Gaussians while retaining its named camera dataset and zero sparse points', async ({ page }) => {
  const id = 'data-d28cbb0f5daf045780e9b015';
  const redirect = await page.request.get('/hub/datasets/open/' + id, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  const manifestUrl = new URL(new URL(redirect.headers().location).searchParams.get('url')!);
  const manifest = await (await page.request.get(manifestUrl.pathname)).json();
  expect(manifest).toMatchObject({ format: 'colmapview-camera-dataset', version: 2 });
  expect(manifest.metadataUrl).toContain('/23e7eaa65ff836405329c7b6b4a34afaeb3a70e2/mic/transforms_train.json');
  expect(manifest.splats).toEqual(['https://huggingface.co/datasets/pablovela5620/nerf-synthetic-mirror/resolve/23e7eaa65ff836405329c7b6b4a34afaeb3a70e2/trained/mic.ply']);
  expect(manifest.pointCloud).toBeUndefined();
  await page.goto('/hub/datasets/entry/' + id);
  await expect(page.locator('[data-stat="points"]')).toHaveText('0');
  await expect(page.locator('main')).toContainText('13,059 Gaussians');
  await expect(page.locator('[data-asset="splats"]')).toHaveText('Splats');
  await expect(page.getByRole('link', { name: 'Try in ColmapView' })).toHaveAttribute('href', '/s/OcularBell');
});

test('the Expo root entry binds its original model instead of selecting a nested sparse variant', async ({ page }) => {
  const id = 'data-01385be0766a2831ee3918cf';
  const source = 'https://huggingface.co/datasets/alandpn/expo_mcm-ufrn/resolve/3e142592fa3d276221c243a01fa6ee69217e23b5/';
  const redirect = await page.request.get('/hub/datasets/open/' + id, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  const manifestUrl = new URL(new URL(redirect.headers().location).searchParams.get('url')!);
  expect(manifestUrl.pathname).toMatch(/\/individual\/manifests\/[a-f0-9]{64}\.manifest\.json$/);
  const response = await page.request.get(manifestUrl.pathname);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.name).toBe('alandpn/expo_mcm-ufrn');
  expect(manifest.files).toEqual({ cameras: source + 'cameras.bin', images: source + 'images.bin', points3D: source + 'points3D.bin' });
  expect(Object.keys(manifest.imageNameToPath)).toHaveLength(81);
  expect(manifest.imageNameToPath['frame_0001.jpg']).toBe(source + 'images/frame_0001.jpg');
  const detail = await page.request.get('/hub/datasets/entry/' + id);
  const html = await detail.text();
  expect(html).toContain('data-stat="cameraPoses">81</dd>');
  expect(html).toContain('data-stat="points">49,817</dd>');
  expect(html).toContain('Scene manifest');
});

test('DTU mask inventories use real mask images and exclude macOS sidecars', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json();
  const source = index.sources.find((item: { sourceId: string }) => item.sourceId === 'hf:Y1ue/DTU');
  const data = await (await page.request.get('/hub/datasets/api/entries?dataset=' + source.id)).json();
  const scene = data.entries.find((entry: { id: string }) => entry.id === 'data-500085ac2578d6ca24b978a8');
  expect(scene.availableData.masks).toEqual({ status: 'listed', count: 64, samplePath: 'DTU/scan105/mask/000.png' });
  for (const entry of data.entries) {
    expect(entry.availableData?.masks?.samplePath ?? '').not.toContain('/._');
    expect(entry.availableData?.masks?.samplePath ?? '').not.toContain('__MACOSX');
  }
});

test('a scene manifest attaches the exact sibling-photo model and selected cloud, with readable saved settings', async ({ page }) => {
  const id = 'data-69b9f9cf0aaab1bc0ece0617';
  await page.goto('/hub/datasets/entry/' + id);
  const origin = new URL(page.url()).origin;
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('3');
  await expect(page.locator('[data-stat="points"]')).toHaveText('350,710');
  await expect(page.locator('[data-asset="images"]')).toHaveAttribute('data-asset-status', 'checked');
  await expect(page.locator('[data-asset="masks"]')).toHaveCount(1);
  await expect(page.locator('main')).toContainText('Native 3D points');
  const opened = await page.request.get('/hub/datasets/open/' + id, { maxRedirects: 0 });
  expect(opened.status()).toBe(302);
  const target = new URL(new URL(opened.headers().location).searchParams.get('url')!);
  expect(target.pathname).toMatch(/^\/hub\/datasets\/individual\/manifests\/[a-f0-9]{64}\.manifest\.json$/);
  const response = await page.request.get(target.pathname);
  const manifest = await response.json();
  expect(manifest.version).toBe(1);
  expect(manifest.files.cameras).toContain('/basketball/dense/sparse_mast3r/cameras.bin');
  expect(manifest.files.images).toContain('/basketball/dense/sparse_mast3r/images.bin');
  expect(manifest.files.points3D).toContain('/basketball/dense/sparse_mast3r/points3D.ply');
  expect(manifest.imageNameToPath['0000.png']).toContain('/basketball/dense/images/0000.png');
  expect(manifest.maskNameToPath['0000.png']).toContain('/basketball/dense/mask/0000.png');
  const statePath = new URL(manifest.viewerStatePath, manifest.baseUrl).pathname;
  const stateResponse = await page.request.get(statePath);
  expect(response.headers()['access-control-allow-origin']).toBe('*');
  expect(stateResponse.headers()['access-control-allow-origin']).toBe('*');
  const client = new URL(origin);
  client.hostname = client.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  client.pathname = '/manifest-cors-client';
  // Chromium's local-network permission is separate from the asset CORS check.
  await page.context().grantPermissions(['local-network-access'], { origin: client.origin });
  await page.route(client.href, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Manifest reader</title>' }));
  await page.goto(client.href);
  const read = await page.evaluate(async urls => Promise.all(urls.map(async url => {
    const response = await fetch(url, { credentials: 'omit' });
    if (!response.ok) throw new Error('Manifest asset read failed');
    return response.json();
  })), [origin + target.pathname, origin + statePath]);
  expect(read[0].files.points3D).toBe(manifest.files.points3D);
  expect(read[1].config.pointCloud.minTrackLength).toBe(0);
  expect(read[1].viewState.target).toHaveLength(3);
});

test('cards show content roles, load same-origin photos and open metadata only on activation', async ({ page, browser }) => {
  const providerRequests: string[] = [];
  page.on('request', request => { if (/huggingface\.co|github\.com|amazonaws\.com|wikimedia\.org/.test(request.url())) providerRequests.push(request.url()); });
  await page.goto('/hub/datasets/?q=scene0024_01&licenseCategory=commercial&photos=available&dataset=hf-zhaoshiwen-blur-slam-bpn-data-fec0f75162f9');
  const first = page.locator('.dataset-card').filter({ has: page.getByRole('link', { name: 'Open in viewer: scene0024_01 · i2slam_colmap', exact: true }) });
  await expect(first.getByRole('list', { name: 'Available data' })).toBeVisible();
  await expect(first.locator('[data-asset="cameras"]')).toBeVisible();
  await expect(first.locator('[data-asset="images"]')).toBeVisible();
  await expect(first.locator('[data-stat="cameraPoses"]')).toHaveText('227');
  await expect(first.locator('[data-stat="cameraModels"]')).toHaveText('1');
  await expect(first.locator('[data-stat="points"]')).toHaveText('23,659');
  await expect(first.locator('[data-stat="cameraPoses"]')).toBeVisible();
  await expect(first.locator('[data-stat="points"]')).toBeVisible();
  await expect(first.locator('[data-stat="cameraModels"]')).not.toBeVisible();
  await expect(first.locator('[data-photo-status]')).not.toBeVisible();
  await expect(first.locator('.dataset-card-footer')).toHaveCount(0);
  const image = first.locator('.dataset-thumbnail');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => [element.complete, element.naturalWidth, element.naturalHeight])).toEqual([true, 320, 320]);
  await expect(image).toHaveAttribute('src', /^\/hub\/datasets\/individual\/thumbnails\/[a-f0-9]{64}\.jpg$/);
  await expect(first.locator('.dataset-open')).toHaveText('scene0024_01 · i2slam_colmap');
  await expect(first.locator('figcaption')).toHaveCount(0);
  await expect(first.locator('.dataset-photo-credit')).not.toBeVisible();
  const textStyle = (selector: string) => first.locator(selector).first().evaluate(element => {
    const style = getComputedStyle(element);
    return [style.fontSize, style.fontWeight, style.color];
  });
  const secondaryStyle = await textStyle('.dataset-label');
  for (const selector of ['[data-asset="cameras"]', '[data-stat="cameraPoses"]', '[data-stat="points"]', '.dataset-statistics-compact dt']) {
    expect(await textStyle(selector)).toEqual(secondaryStyle);
  }
  const info = first.getByRole('button', { name: /Metadata/ });
  const panel = first.getByRole('dialog', { name: /Metadata/ });
  const catalogUrl = page.url();
  await first.hover();
  await expect(panel).not.toBeVisible();
  await info.focus();
  await expect(panel).not.toBeVisible();
  await info.click();
  await expect(panel).toBeVisible();
  await expect(info).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await expect(first.locator('[data-stat="cameraModels"]')).toBeVisible();
  await expect(first.locator('[data-photo-status]')).toBeVisible();
  await expect(first.locator('.dataset-photo-credit')).toBeVisible();
  await expect(first.locator('.dataset-metadata-title')).toHaveText('data/i2slam_colmap/scene0024_01');
  await expect(panel.getByRole('link', { name: 'Original source', exact: false })).toHaveAttribute('href', 'https://huggingface.co/datasets/zhaoshiwen/blur-slam-bpn-data');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(first.locator('[data-stat="cameraModels"]')).not.toBeVisible();
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  await expect(info).toBeFocused();
  await info.press('Enter');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('link', { name: 'Full metadata', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('button', { name: 'Copy link', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(panel.getByRole('link', { name: 'Related scenes', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(panel.getByRole('button', { name: 'Copy link', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(panel.getByRole('link', { name: 'Full metadata', exact: true })).toBeFocused();
  await info.focus();
  await expect(panel.getByRole('link', { name: 'Full metadata', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(info).toBeFocused();
  await info.press('Space');
  await expect(panel).toBeVisible();
  await page.mouse.click(16, 16);
  await expect(panel).not.toBeVisible();
  await expect(info).toHaveAttribute('aria-expanded', 'false');
  await expect(info).toBeFocused();
  await expect(page).toHaveURL(catalogUrl);
  await page.setViewportSize({ width: 390, height: 360 });
  await info.click();
  await expect(panel).toBeVisible();
  expect(await panel.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 360 });
  await panel.getByRole('link', { name: 'Full metadata', exact: true }).scrollIntoViewIfNeeded();
  await expect(panel.getByRole('link', { name: 'Full metadata', exact: true })).toBeInViewport();
  await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = (await image.boundingBox())!;
  const caption = (await first.locator('.dataset-card-body').boundingBox())!;
  expect(Math.abs(bounds.x - caption.x)).toBeLessThan(1);
  expect(Math.abs(bounds.width - caption.width)).toBeLessThan(1);
  expect(caption.y).toBeGreaterThan(bounds.y);
  expect(Math.abs(bounds.y + bounds.height - caption.y - caption.height)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.catalog-advanced > summary').click();
  await page.getByRole('combobox', { name: 'License category', exact: true }).selectOption('non-commercial');
  await expect(page.locator('.dataset-thumbnail')).toHaveCount(0);
  expect(providerRequests).toEqual([]);
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    const phone = await touch.newPage();
    await phone.goto(new URL('/hub/datasets/?q=scene0024_01&dataset=hf-zhaoshiwen-blur-slam-bpn-data-fec0f75162f9', page.url()).href);
    const info = phone.getByRole('button', { name: /Metadata for/ }).first();
    await expect(info).toBeVisible();
    const target = (await info.boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    for (const control of await phone.locator('.icon-button').filter({ visible: true }).all()) {
      const bounds = (await control.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    await info.tap();
    await expect(phone.getByRole('dialog')).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await touch.close(); }
});

test('previews cover custom and non-commercial licenses while preserving the reported terms', async ({ page }) => {
  const providerRequests: string[] = [];
  page.on('request', request => { if (/huggingface\.co|github\.com|amazonaws\.com|wikimedia\.org/.test(request.url())) providerRequests.push(request.url()); });
  const query = 'dataset=hf-alexmkwizu-gaussian-training-datasets-3d278c96cb37';
  await page.goto('/hub/datasets/?' + query);
  await expect(page.locator('.dataset-card')).toHaveCount(11);
  await expect(page.locator('.dataset-thumbnail')).toHaveCount(11);
  const first = page.locator('.dataset-card').first();
  await expect.poll(() => first.locator('.dataset-thumbnail').evaluate((image: HTMLImageElement) => [image.complete, image.naturalWidth, image.naturalHeight])).toEqual([true, 320, 320]);
  await first.getByRole('button', { name: /Metadata/ }).click();
  await expect(first.locator('.dataset-metadata')).toContainText('Not specified');
  await expect(first.locator('.dataset-photo-credit')).toContainText('other');
  await first.getByRole('button', { name: 'Close', exact: true }).click();
  const data = await (await page.request.get('/hub/datasets/api/entries?' + query)).json();
  for (const entry of data.entries) {
    expect(entry.license).toBe('other');
    expect(entry.licenseCategory).toBe('not-specified');
    expect(entry.thumbnail.datasetLicense).toBe('other');
    expect(entry.thumbnail.url).toMatch(/^\/hub\/datasets\/individual\/thumbnails\/[a-f0-9]{64}\.jpg$/);
  }
  await page.goto('/hub/datasets/?licenseCategory=non-commercial&photos=available');
  await expect(page.locator('.dataset-card').first().locator('.dataset-thumbnail')).toBeVisible();
  expect(providerRequests).toEqual([]);
});

test('newly audited text statistics and confirmed zero point counts are retained', async ({ page }) => {
  await page.goto('/hub/datasets/entry/data-3a6fa2f8987b22f3d3d28276');
  for (const [field, value] of [['cameraPoses', '382'], ['cameraModels', '1'], ['points', '33,231']]) {
    await expect(page.locator(`[data-stat="${field}"]`)).toHaveText(value);
  }
  await page.goto('/hub/datasets/entry/data-f85333e7c1adb523358813a8');
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('6');
  await expect(page.locator('[data-stat="cameraModels"]')).toHaveText('6');
  await expect(page.locator('[data-stat="points"]')).toHaveText('0');
});

test('Oxford text-model cards, details and API use their own audited totals and preserve the viewer target', async ({ page }) => {
  const id = 'data-3687bfe0e161a673d58b8a1e';
  await page.goto('/hub/datasets/?q=keble');
  const card = page.locator(`[data-entry-id="${id}"]`);
  await expect(card.locator('[data-stat="cameraPoses"]')).toHaveText('1,020');
  await expect(card.locator('[data-stat="points"]')).toHaveText('1,667,969');
  await expect(card.locator('[data-asset="images"]')).toHaveCount(0);
  await card.getByRole('button', { name: /Metadata/ }).click();
  await expect(card.locator('[data-stat="cameraModels"]')).toHaveText('1');
  await card.getByRole('link', { name: 'Full metadata', exact: true }).click();
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('1,020');
  await expect(page.locator('[data-stat="points"]')).toHaveText('1,667,969');
  await expect(page.locator('main')).toContainText('Complete text files (cameras.txt, images.txt, points3D.txt) parsed');
  const data = await (await page.request.get('/hub/datasets/api/entries?q=keble')).json();
  expect(data.entries.find((entry: { id: string }) => entry.id === id).sceneStats).toEqual({ cameraPoses: 1020, cameraModels: 1, points: 1667969 });
  const open = await page.request.get('/hub/datasets/open/' + id, { maxRedirects: 0 });
  expect(open.status()).toBe(302);
  expect(new URL(open.headers().location).searchParams.get('url')).toBe('https://huggingface.co/datasets/active-vision-lab/oxford-day-and-night/resolve/cbd9537ca5f70efca53912fc08adbc189ea66da2/aria/keble-college/visual_reloc/colmap/text');
});

test('complete text-model counts and manifest photo requirements appear in the reported scene', async ({ page }) => {
  await page.goto('/hub/datasets/entry/data-77e8433b8e133fba6007a66e');
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('737');
  await expect(page.locator('[data-stat="cameraModels"]')).toHaveText('1');
  await expect(page.locator('[data-stat="points"]')).toHaveText('49,379');
  await expect(page.locator('[data-asset="images"]')).toHaveText('Images');
  await expect(page.locator('main')).toContainText('Photo association manifest');
  await expect(page.locator('main')).toContainText('EVSSM-deblurred');
  await expect(page.locator('main')).toContainText('737/737');
  await expect(page.locator('main')).toContainText('The launch manifest declares');
  await expect(page.locator('main')).toContainText('Scene statistics check');
  const csv = await page.request.get('/hub/datasets/individual/photo-audit.csv');
  expect(await csv.text()).toContain('data/i2slam_trigsplat_gt/scene0736_00_manifest.json');
});

test('Kicker retains counts, sibling photo policy and verified streamed-export evidence', async ({ page }) => {
  await page.goto('/hub/datasets/entry/data-ea3370325634b929035638c5');
  await expect(page.locator('[data-stat="cameraPoses"]')).toHaveText('31');
  await expect(page.locator('[data-stat="cameraModels"]')).toHaveText('1');
  await expect(page.locator('[data-stat="points"]')).toHaveText('15,897');
  await expect(page.locator('[data-asset="images"]')).toHaveText('Images');
  await expect(page.locator('[data-asset="images"]')).toHaveAttribute('data-asset-status', 'checked');
  await expect(page.locator('main')).toContainText('31/31');
  await expect(page.locator('main')).toContainText('kicker/images');
  await expect(page.locator('main')).toContainText('6048 x 4032');
  await expect(page.locator('main')).toContainText('complete COLMAP and original-photo ZIP preserves all registered names');
  await expect(page.locator('main')).toContainText('Photograph pixels decoded');
  await expect(page.locator('main')).toContainText('414,603,162-byte image package');
  await expect(page.locator('main')).toContainText('every photo CRC and SHA-256 against the pinned publisher LFS objects');
  await expect(page.locator('main')).not.toContainText('256 MiB package budget');
  await expect(page.locator('main')).not.toContainText('All photos verified in export');
  const open = await page.request.get('/hub/datasets/open/data-ea3370325634b929035638c5', { maxRedirects: 0 });
  expect(open.status()).toBe(302);
  const target = new URL(new URL(open.headers().location).searchParams.get('url')!);
  const manifest = await (await page.request.get(target.pathname)).json();
  const model = 'https://huggingface.co/datasets/alexmkwizu/colmap-testing-dataset/resolve/511152c3b9cd20ecda698e1ed1559c341ee777ab/kicker/dslr_calibration_jpg/';
  expect(manifest.files).toEqual({ cameras: model + 'cameras.txt', images: model + 'images.txt', points3D: model + 'points3D.txt' });
  expect(Object.keys(manifest.imageNameToPath)).toHaveLength(31);
});

test('ZIP photo previews retain image credits and describe automatic archive loading', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json();
  const source = index.sources.find((source: { sourceId: string }) => source.sourceId === 'hf:cornell-vailab/megaunscene');
  await page.goto('/hub/datasets/?photos=companion_archive&dataset=' + source.id);
  const first = page.locator('.dataset-card').first();
  const identity = await first.getAttribute('data-entry-id');
  const summary = JSON.parse((await page.locator('#catalog-initial-data').textContent())!).entries
    .find((entry: { id: string }) => entry.id === identity);
  await expect(first.locator('[data-asset="images"]')).toHaveText('Images · archive');
  await expect(first.locator('.dataset-thumbnail')).toBeVisible();
  await expect(first.locator('figcaption')).toHaveCount(0);
  await first.getByRole('button', { name: /Metadata/ }).click();
  await expect(first.locator('.dataset-photo-credit a').first()).toHaveAttribute('href', /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
  await expect(first.locator('.dataset-photo-credit')).toContainText(summary.thumbnail.license === 'pd' ? 'Public domain' : summary.thumbnail.license);
  await first.getByRole('link', { name: 'Full metadata', exact: true }).click();
  await expect(page.locator('main')).toContainText('Preview attribution');
  await expect(page.locator('main')).toContainText('The launch manifest attaches both');
  await expect(page.locator('main')).toContainText('Archive members are indexed and read lazily');
  await expect(page.getByRole('link', { name: 'Try in ColmapView', exact: true })).toBeVisible();
});

for (const selected of [
  { id: 'data-ebc089e808b20c73bbbfa268', sequence: 's4/HouseFootwork', role: 'points3D', frame: '0000242', timestamp: 241, points: 62455, count: 62455 },
  { id: 'data-b41ab2a34430b23d25428e3c', sequence: 's4/3PointStep', role: 'splat', frame: '0000001', timestamp: 0, points: 0, count: 18280 },
]) test(`selected ${selected.role} archive frame retains native cameras and truthful sparse counts`, async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json();
  const source = index.sources.find((source: { sourceId: string }) => source.sourceId === 'hf:nyuvideolab/danceNet3D');
  const result = await (await page.request.get('/hub/datasets/api/entries?dataset=' + source.id + '&q=' + encodeURIComponent(selected.sequence.replace('/', ' ')))).json();
  const entry = result.entries.find((entry: { id: string }) => entry.id === selected.id);
  expect(entry).toBeDefined();
  expect(entry.availableData.splats).toMatchObject({ status: selected.role === 'splat' ? 'checked' : 'archive', archiveFormat: 'zip' });
  expect(entry.availableData.masks).toMatchObject({ status: 'archive', archiveFormat: 'tar.zst' });
  expect(entry.sceneStats.points).toBe(selected.points);
  expect(entry.sceneStats.cameraPoses).toBe(29);
  await page.goto('/hub/datasets/entry/' + entry.id);
  await expect(page.locator('[data-asset="splats"]')).toHaveText(selected.role === 'splat' ? 'Splats' : 'Splats · archive');
  await expect(page.locator('[data-asset="masks"]')).toHaveText('Masks · archive');
  await expect(page.locator('main')).toContainText('splats archive member');
  await expect(page.locator('main')).toContainText(entry.availableData.splats.archiveMember);
  await expect(page.locator('main')).toContainText('Selected frame');
  await expect(page.locator('main')).toContainText(selected.count.toLocaleString('en-US') + (selected.role === 'splat' ? ' Gaussians' : ' untracked XYZ points'));
  await expect(page.locator('[data-stat="points"]')).toHaveText(selected.points.toLocaleString('en-US'));
  const opened = await page.request.get(entry.openUrl, { maxRedirects: 0 });
  expect(opened.status()).toBe(302);
  const target = new URL(new URL(opened.headers().location).searchParams.get('url')!);
  const manifest = await (await page.request.get(target.pathname)).json();
  expect(manifest.version).toBe(4);
  expect(manifest.skipImages).toBeUndefined();
  expect(Object.keys(manifest.videoImages)).toHaveLength(29);
  for (const video of Object.values(manifest.videoImages) as { url: string; timestamp: number }[]) {
    expect(video.url).toContain('/' + selected.sequence + '/');
    expect(video.timestamp).toBe(selected.timestamp);
  }
  expect(manifest.files.points3D).toBeUndefined();
  expect(manifest.geometryFiles).toHaveLength(1);
  expect(manifest.geometryFiles[0]).toMatchObject({ role: selected.role, format: selected.role === 'splat' ? 'zip' : 'tar.zst', member: { path: selected.frame + '.ply' } });
  expect(manifest.files.cameras).toContain('/' + selected.sequence + '/colmap/cameras.bin');
  const state = await (await page.request.get(new URL(manifest.viewerStatePath, manifest.baseUrl).pathname)).json();
  if (selected.role === 'splat') {
    expect(state.config.splat.transform).toEqual({ scale: 1, rotationX: 0, rotationY: 0, rotationZ: 0, translationX: 0, translationY: 1.5, translationZ: 1.3 });
    expect(state.config.pointCloud.colorMode).toBe('splats');
  } else expect(state.config.pointCloud.minTrackLength).toBe(0);
});

test('model-only ArmGS cards show masks and cameras without claiming photos', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json() as { sources: { id: string; sourceId: string }[] };
  const source = index.sources.find(source => source.sourceId === 'hf:Dororo99/Ours_Waymo_ArmGS')!;
  await page.goto('/hub/datasets/?dataset=' + source.id);
  await expect(page.locator('#catalog-count')).toHaveAccessibleName(/of 11 scene datasets/);
  const first = page.locator('.dataset-card').first();
  await expect(first.locator('[data-asset="cameras"]')).toBeVisible();
  await expect(first.locator('[data-asset="masks"]')).toBeVisible();
  await expect(first.locator('[data-asset="images"]')).toHaveCount(0);
  await expect(first.locator('.dataset-thumbnail')).toHaveCount(0);
  const placeholder = first.getByRole('img', { name: /^No photo:/ });
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toHaveText('No photo');
  await first.getByRole('button', { name: /Metadata/ }).click();
  await expect(first.locator('[data-photo-status]')).toBeVisible();
  await expect(first.locator('[data-photo-status]')).toHaveText('Photos not included');
  await expect(first.getByRole('link', { name: 'Original source', exact: false })).toHaveAttribute('href', 'https://huggingface.co/datasets/Dororo99/Ours_Waymo_ArmGS');
});
