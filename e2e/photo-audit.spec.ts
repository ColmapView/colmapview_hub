import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const sceneId = (source: string, path: string) => 'data-' + createHash('sha256').update([source, 'colmap', '', path].join('\0')).digest('hex').slice(0, 24);

test('photo evidence covers every published scene and keeps stronger export checks separate', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json() as {
    total: number; generation: string; sources: unknown[]; photos: Record<string, number> };
  expect(index.total).toBeGreaterThan(0);
  expect(Object.keys(index.photos).sort()).toEqual(['sample_checked', 'path_policy_required', 'review_required', 'not_found',
    'not_included', 'companion_archive', 'partial', 'complete_export_checked'].sort());
  expect(Object.values(index.photos).reduce((sum, count) => sum + count, 0)).toBe(index.total);
  const available = await (await page.request.get('/hub/datasets/api/entries?photos=available')).json() as {
    total: number; entries: { photoStatus: string }[] };
  expect(available.total).toBe(index.photos.complete_export_checked + index.photos.sample_checked + index.photos.partial);
  expect(available.entries.every(entry => ['complete_export_checked', 'sample_checked', 'partial'].includes(entry.photoStatus))).toBe(true);
  const audit = await (await page.request.get('/hub/datasets/individual/photo-audit.json')).json();
  expect(audit).toMatchObject({ generation: index.generation, scenes: index.total, collections: index.sources.length, photos: index.photos });
  const csv = await page.request.get('/hub/datasets/individual/photo-audit.csv');
  expect(csv.ok()).toBe(true);
  expect(await csv.text()).toContain('mappingFile,companionArchive,samplePhoto');
  expect(await csv.text()).toContain('launchRouting,photoManifest,listedPhotos,boundNamesChecked');
  expect(audit.routing.photo_inventory_manifest).toBe(1247);
  expect(audit.routing.photo_archive_manifest).toBe(516);
  expect(audit.routing.prefix_manifest).toBe(238);
  expect(audit.routing.full_scene_manifest).toBe(17);
  expect(audit.repeatAudit.skip_confirmed_facts).toBeGreaterThan(0);
  expect(audit.repeatAudit.review_required).toBeGreaterThanOrEqual(0);
  expect(audit.repeatAudit.skip_confirmed_facts + audit.repeatAudit.review_required).toBe(index.total);
  expect(await csv.text()).toContain('auditDecision,repeatAudit,decisionScope,nextAuditAction');
  expect(await csv.text()).not.toContain('Eiffel_Tower_Scene');
  await page.goto('/hub/datasets/audit');
  await expect(page.getByRole('heading', { name: 'Photograph availability' })).toBeVisible();
  await expect(page.getByRole('link', { name: /photo availability and path policy \(CSV\)/ })).toHaveAttribute('href', '/hub/datasets/individual/photo-audit.csv');
});

test('photo filtering survives Back and Forward and makes no provider requests', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json() as { total: number; photos: Record<string, number> };
  const count = (total: number) => `of ${total.toLocaleString('en-US')} scene datasets`;
  const providerRequests: string[] = [];
  page.on('request', request => { if (/huggingface\.co|github\.com|amazonaws\.com/.test(request.url())) providerRequests.push(request.url()); });
  await page.goto('/hub/datasets/?photos=not_included');
  await expect(page.locator('#catalog-count')).toContainText(count(index.photos.not_included));
  await expect(page.locator('[data-photo-status]').first()).toHaveText('Photos not included');
  await page.getByRole('combobox', { name: 'Photographs', exact: true }).selectOption('not_found');
  await expect(page.locator('#catalog-count')).toContainText(count(index.photos.not_found));
  await page.goBack();
  await expect(page.locator('#catalog-count')).toContainText(count(index.photos.not_included));
  await expect(page.getByRole('combobox', { name: 'Photographs', exact: true })).toHaveValue('not_included');
  await page.goForward();
  await expect(page.locator('#catalog-count')).toContainText(count(index.photos.not_found));
  await expect(page.getByRole('combobox', { name: 'Photographs', exact: true })).toHaveValue('not_found');
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#catalog-count')).toContainText(count(index.total));
  expect(providerRequests).toEqual([]);
});

test('Dynamic Maps keeps all pose statistics and displays the complete photograph frame', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json();
  const source = index.sources.find((source: { sourceId: string }) => source.sourceId === 'hf:dynamic-maps/hard-intersection-multimodal-sample');
  const result = await (await page.request.get('/hub/datasets/api/entries?dataset=' + source.id)).json();
  expect(result.total).toBe(1);
  expect(result.entries[0].sceneStats).toMatchObject({ cameraPoses: 896, cameraModels: 32, points: 0 });
  await page.goto('/hub/datasets/?dataset=' + source.id);
  const thumbnail = page.locator('.dataset-thumbnail');
  await expect(thumbnail).toBeVisible();
  await expect(thumbnail).toHaveJSProperty('naturalWidth', 320);
  await expect(thumbnail).toHaveJSProperty('naturalHeight', 234);
  const box = (await thumbnail.boundingBox())!;
  expect(Math.abs(box.width / box.height - 320 / 234)).toBeLessThan(0.01);
});

test('OpenMVG retains its embedded sparse points in API, cards and the pinned viewer target', async ({ page }) => {
  const result = await (await page.request.get('/hub/datasets/api/entries?q=SceauxCastle')).json();
  expect(result.total).toBe(1);
  const scene = result.entries[0];
  expect(scene.sceneStats).toEqual({ cameraPoses: 11, cameraModels: 11, points: 6586 });
  expect(scene.availableData.point_cloud).toMatchObject({ status: 'checked', count: 6586 });
  await page.goto('/hub/datasets/?q=SceauxCastle');
  await expect(page.locator('[data-stat="points"]')).toHaveText('6,586');
  await expect(page.locator('.dataset-contents')).toContainText('Point cloud');
  const opened = await page.request.get(scene.openUrl, { maxRedirects: 0 });
  expect(opened.status()).toBe(302);
  expect(new URL(opened.headers().location).searchParams.get('url')).toBe('https://raw.githubusercontent.com/openMVG/openMVG/6887e7385400f4cca378507296ccc20c8a0837dd/src/software/SfM/python/sfm_viewer/sample_data/sfm_data.json');
});

test('companion ZIP requirements remain explicit and Waymo mappings launch through pinned photo manifests', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json() as {
    sources: { id: string; sourceId: string }[] };
  const archiveSource = index.sources.find(source => source.sourceId === 'hf:cornell-vailab/megaunscene')!;
  await page.goto('/hub/datasets/?photos=companion_archive&dataset=' + archiveSource.id);
  await expect(page.locator('#catalog-count')).toContainText('of 478 scene datasets');
  await expect(page.locator('[data-photo-status]').first()).toHaveText('Photos in a separate archive');
  const zipped = await (await page.request.get('/hub/datasets/api/entries?photos=companion_archive&dataset=' + archiveSource.id)).json() as {
    entries: { id: string; openUrl: string; photoStatus: string }[] };
  await page.goto('/hub/datasets/entry/' + zipped.entries[0].id);
  await expect(page.locator('main')).toContainText('Separate image archive');
  await expect(page.locator('main')).toContainText('Archive members are indexed and read lazily');
  await expect(page.locator('main')).not.toContainText('current model link does not attach that ZIP');
  const zipOpen = await page.request.get(zipped.entries[0].openUrl, { maxRedirects: 0 });
  expect(zipOpen.status()).toBe(302);
  const zipManifestUrl = new URL(new URL(zipOpen.headers().location).searchParams.get('url')!);
  const zipManifest = await (await page.request.get(zipManifestUrl.pathname)).json();
  expect(zipManifest.version).toBe(2);
  expect(zipManifest.mediaArchives[0].url).toContain('/images.zip');
  const waymo = index.sources.find(source => source.sourceId === 'hf:Dororo99/Ours-V2_waymo_ArmGS')!;
  const mapping = await (await page.request.get('/hub/datasets/api/entries?dataset=' + waymo.id)).json() as {
    total: number; entries: { id: string; openUrl: string; photoStatus: string; sceneStats: { cameraPoses: number } }[] };
  expect(mapping.total).toBe(10);
  expect(mapping.entries.every(entry => entry.photoStatus === 'sample_checked')).toBe(true);
  await page.goto('/hub/datasets/entry/' + mapping.entries[0].id);
  await expect(page.locator('main')).toContainText('Image-name mapping');
  await expect(page.locator('main')).toContainText('mapping.json');
  await expect(page.locator('main')).toContainText('Six-digit COLMAP image names map explicitly to eight-digit cache PNG paths');
  for (const entry of mapping.entries) {
    const open = await page.request.get(entry.openUrl, { maxRedirects: 0 });
    expect(open.status()).toBe(302);
    const target = new URL(new URL(open.headers().location).searchParams.get('url')!);
    expect(target.pathname).toMatch(/\/individual\/manifests\/[a-f0-9]{64}\.manifest\.json$/);
    const response = await page.request.get(target.pathname);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    const manifest = await response.json();
    expect(manifest.files.cameras).toContain('/colmap/');
    expect(manifest.imageNameToPath['FRONT/000000.png']).toContain('/images/FRONT/00000000.png');
    // These scenes have different lengths; match each model's audited pose count.
    expect(entry.sceneStats.cameraPoses).toBeGreaterThan(0);
    expect(Object.keys(manifest.imageNameToPath)).toHaveLength(entry.sceneStats.cameraPoses);
    const images = new Set(manifest.images);
    expect(manifest.images.length).toBeGreaterThanOrEqual(entry.sceneStats.cameraPoses);
    expect(Object.values(manifest.imageNameToPath).every(path => images.has(path))).toBe(true);
  }
});

test('TAR manifests attach checked photographs and retain calibration limitations', async ({ page }) => {
  const providers: string[] = [];
  page.on('request', request => { if (/huggingface\.co|amazonaws\.com/.test(request.url())) providers.push(request.url()); });
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json();
  const source = index.sources.find((source: { sourceId: string }) => source.sourceId === 'hf:whc/fastmap_sfm');
  await page.goto('/hub/datasets/?photos=companion_archive&dataset=' + source.id + '&q=m360_bicycle');
  const card = page.locator('.dataset-card').first();
  await expect(card.locator('[data-asset="images"]')).toHaveText('Images · archive');
  await expect(card.locator('.dataset-thumbnail')).toBeVisible();
  await card.getByRole('button', { name: /Metadata/ }).click();
  await expect(card.locator('[data-photo-status]')).toHaveText('Photos in a separate archive');
  await card.getByRole('link', { name: 'Full metadata', exact: true }).click();
  await expect(page.locator('main')).toContainText('At least 1 image member listed');
  await expect(page.locator('main')).toContainText('Archive members are indexed and read lazily');
  const open = await page.request.get('/hub/datasets/open/data-c11e028799bfa121d0f8ea13', { maxRedirects: 0 });
  expect(open.status()).toBe(302);
  const manifestUrl = new URL(new URL(open.headers().location).searchParams.get('url')!);
  const manifest = await (await page.request.get(manifestUrl.pathname)).json();
  expect(manifest.version).toBe(2);
  expect(manifest.files.cameras).toContain('/ground_truths/m360_bicycle/cameras.bin');
  expect(manifest.mediaArchives[0].stripPrefix).toBe('m360_bicycle');
  await page.goto('/hub/datasets/entry/data-0c5127dab3fe12c39f4c4660');
  await expect(page.locator('main')).toContainText('camera dimensions differ');
  await expect(page.locator('main')).toContainText('extraction and renaming alone do not establish correct projection');
  expect(providers).toEqual([]);
});

test('later TV photographs show partial sampled coverage without changing camera loading', async ({ page }) => {
  for (const [id, count] of [['data-9f28674f0f884957979b0a58', '9/139 inspected names from 5493 registered poses'],
    ['data-8110d379a298766a8274b55d', '1/30 inspected names from 1485 registered poses']]) {
    await page.goto('/hub/datasets/entry/' + id);
    await expect(page.locator('.dataset-thumbnail')).toBeVisible();
    await expect(page.locator('[data-asset="images"]')).toHaveText('Images · partial');
    await expect(page.locator('main')).toContainText(count);
    await expect(page.locator('main')).not.toContainText('All photos verified in export');
    expect((await page.request.get('/hub/datasets/open/' + id, { maxRedirects: 0 })).status()).toBe(302);
  }
});

test('compressed splats require conversion and empty geometry does not receive a presence badge', async ({ page }) => {
  const packed = sceneId('hf:promc/reconstruction-scenes', 'lawn-tree');
  await page.goto('/hub/datasets/entry/' + packed);
  await expect(page.locator('[data-asset="splats"]')).toHaveText('Splats · setup');
  await expect(page.locator('[data-asset="geometry"]')).toHaveCount(0);
  await expect(page.locator('main')).toContainText('Convert it to standard Gaussian PLY');
  expect((await page.request.get('/hub/datasets/open/' + packed, { maxRedirects: 0 })).status()).toBe(302);
  await page.goto('/hub/datasets/entry/' + sceneId('hf:lishenyu/Plant3D', 'plant/plant_000/dense/sparse'));
  await expect(page.locator('[data-asset="geometry"]')).toHaveCount(0);
  await expect(page.locator('[data-asset="cameras"]')).toBeVisible();
  await expect(page.locator('[data-asset="images"]')).toBeVisible();
});

test('confirmed truncated native models are absent from detail, open and search routes', async ({ page }) => {
  for (const path of ['Eiffel_Tower_Scene/sparse/0', 'Eiffel_Tower_Scene/distorted/sparse/0']) {
    const id = sceneId('hf:AmirHossein-razlighi/Confident_Splatting', path);
    expect((await page.request.get('/hub/datasets/entry/' + id)).status()).toBe(404);
    expect((await page.request.get('/hub/datasets/open/' + id, { maxRedirects: 0 })).status()).toBe(404);
  }
  const search = await (await page.request.get('/hub/datasets/api/entries?q=Eiffel%20Tower')).json();
  expect(search).toMatchObject({ total: 0, entries: [] });
});
