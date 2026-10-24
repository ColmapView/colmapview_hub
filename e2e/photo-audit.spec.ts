import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

const sceneId = (source: string, path: string) => 'data-' + createHash('sha256').update([source, 'colmap', '', path].join('\0')).digest('hex').slice(0, 24);

test('photo evidence covers every published scene and keeps stronger export checks separate', async ({ page }) => {
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json() as {
    total: number; generation: string; sources: unknown[]; photos: Record<string, number>; photoRouting: Record<string, number> };
  expect(index.total).toBeGreaterThan(0);
  const photoStates = ['sample_checked', 'path_policy_required', 'review_required', 'not_found',
    'not_included', 'companion_archive', 'partial', 'complete_export_checked', 'video_frames'];
  for (const [status, count] of Object.entries(index.photos)) {
    expect(photoStates).toContain(status);
    expect(Number.isSafeInteger(count) && count >= 0).toBe(true);
  }
  expect(Object.values(index.photos).reduce((sum, count) => sum + count, 0)).toBe(index.total);
  const available = await (await page.request.get('/hub/datasets/api/entries?photos=available')).json() as {
    total: number; entries: { photoStatus: string }[] };
  expect(available.total).toBe(['complete_export_checked', 'sample_checked', 'partial', 'video_frames']
    .reduce((sum, status) => sum + (index.photos[status] ?? 0), 0));
  expect(available.entries.every(entry => ['complete_export_checked', 'sample_checked', 'partial', 'video_frames'].includes(entry.photoStatus))).toBe(true);
  const audit = await (await page.request.get('/hub/datasets/individual/photo-audit.json')).json();
  expect(audit).toMatchObject({ generation: index.generation, scenes: index.total, collections: index.sources.length, photos: index.photos });
  const csv = await page.request.get('/hub/datasets/individual/photo-audit.csv');
  expect(csv.ok()).toBe(true);
  const csvText = await csv.text(), header = csvText.split(/\r?\n/, 1)[0];
  expect(header).toContain('mappingFile,companionArchive,samplePhoto');
  expect(header).toContain('launchRouting,photoManifest,listedPhotos,videoFrames,videoSources,videoTimestamp,videoTemporalScope,boundNamesChecked');
  expect(audit.routing).toEqual(index.photoRouting);
  expect(Object.values(index.photoRouting).reduce((sum, count) => sum + count, 0)).toBe(index.total);
  const manifests = JSON.parse(await readFile(new URL('../data/scene-manifests.json', import.meta.url), 'utf8'));
  const generic = JSON.parse(await readFile(new URL('../data/video-frame-mappings.json', import.meta.url), 'utf8'));
  const legacy = JSON.parse(gunzipSync(await readFile(new URL('../data/video-frame-routing.json.gz', import.meta.url))).toString());
  type Selection = { sourceId: string; kind: string; path: string };
  const key = (selection: Selection) => JSON.stringify([selection.sourceId, selection.kind, selection.path]);
  const fullModelSelections = new Set(manifests.scenes.map(key));
  const nativeOnly = generic.scenes.filter((selection: Selection) => !fullModelSelections.has(key(selection))).length;
  expect(audit.routing.full_scene_manifest + audit.routing.video_frames_manifest).toBe(manifests.scenes.length + nativeOnly);
  expect(audit.routing.video_frames_manifest).toBe(legacy.scenes.length + generic.scenes.length);
  expect(audit.repeatAudit.skip_confirmed_facts).toBeGreaterThan(0);
  expect(audit.repeatAudit.review_required).toBeGreaterThanOrEqual(0);
  expect(audit.repeatAudit.skip_confirmed_facts + audit.repeatAudit.review_required).toBe(index.total);
  expect(header).toContain('auditDecision,repeatAudit,decisionScope,nextAuditAction');
  expect(csvText.includes('Eiffel_Tower_Scene')).toBe(false);
  await page.goto('/hub/datasets/audit');
  await expect(page.getByRole('heading', { name: 'Photograph availability' })).toBeVisible();
  await expect(page.getByRole('link', { name: /photo availability and path policy \(CSV\)/ })).toHaveAttribute('href', '/hub/datasets/individual/photo-audit.csv');
});

test('camera video imagery has its own filter and matching-frame launch while model export evidence remains separate', async ({ page }) => {
  const providerRequests: string[] = [];
  page.on('request', request => { if (/huggingface\.co|github\.com|amazonaws\.com/.test(request.url())) providerRequests.push(request.url()); });
  const result = await (await page.request.get('/hub/datasets/api/entries?photos=video_frames')).json();
  const index = await (await page.request.get('/hub/datasets/individual/index.json')).json();
  expect(result.total).toBe(index.photos.video_frames);
  expect(result.entries.every((entry: { photoStatus: string }) => entry.photoStatus === 'video_frames')).toBe(true);
  await page.goto('/hub/datasets/?photos=video_frames');
  await expect(page.locator('#catalog-count')).toContainText(`of ${result.total.toLocaleString('en-US')} scene datasets`);
  await expect(page.getByRole('combobox', { name: 'Photographs', exact: true })).toHaveValue('video_frames');
  await expect(page.locator('[data-photo-status]').first()).toHaveText('Frames from camera videos');
  const id = 'data-7ab128e89d676305e079e729';
  const open = await page.request.get('/hub/datasets/open/' + id, { maxRedirects: 0 });
  expect(open.status()).toBe(302);
  const target = new URL(new URL(open.headers().location).searchParams.get('url')!);
  const response = await page.request.get(target.pathname);
  expect(response.headers()['access-control-allow-origin']).toBe('*');
  const manifest = await response.json();
  expect(manifest.version).toBe(4); expect(manifest.skipImages).toBeUndefined();
  expect(Object.keys(manifest.videoImages)).toHaveLength(28);
  for (const video of Object.values(manifest.videoImages) as { url: string; bytes: number; timestamp: number }[]) {
    expect(video.url).toContain('/resolve/5ecd1b71d0c13b176dbdbe358b940624759d678f/s6/BiancaGolden_Ocho/');
    expect(video.timestamp).toBe(240); expect(video.bytes).toBeGreaterThan(0);
  }
  expect(manifest.geometryFiles[0].member.path).toBe('0000242.ply');
  await page.goto('/hub/datasets/entry/' + id);
  await expect(page.locator('main')).toContainText('Model-only export SHA-256');
  await expect(page.locator('main')).toContainText('One frame per scene decoded at camera resolution');
  await expect(page.locator('main')).not.toContainText('All registered originals checked');
  expect(providerRequests).toEqual([]);
});

test('per-pose video mappings expose view/source counts and source feature warnings without claiming full export', async ({ page }) => {
  const providerRequests: string[] = [];
  page.on('request', request => { if (/huggingface\.co|github\.com|amazonaws\.com/.test(request.url())) providerRequests.push(request.url()); });
  const id = 'data-92baac9828db4bc141448f90';
  const open = await page.request.get('/hub/datasets/open/' + id, { maxRedirects: 0 });
  expect(open.status()).toBe(302);
  const target = new URL(new URL(open.headers().location).searchParams.get('url')!);
  const response = await page.request.get(target.pathname), manifest = await response.json();
  expect(manifest.version).toBe(5); expect(manifest.skipImages).toBeUndefined();
  expect(Object.keys(manifest.videoImages)).toHaveLength(285);
  const bindings = Object.values(manifest.videoImages) as { url: string; frameIndex: number; timestamp?: number }[];
  expect(new Set(bindings.map(binding => binding.url)).size).toBe(6);
  expect(bindings.every(binding => Number.isSafeInteger(binding.frameIndex) && binding.frameIndex >= 0 && binding.timestamp === undefined)).toBe(true);
  expect(manifest.videoImages['campus_nlp/cam00/000000_a.jpg'].frameIndex).toBe(7);
  expect(manifest.videoImages['campus_nlp/cam03/000170_d.jpg'].frameIndex).toBe(67);
  expect(manifest.videoImages['campus_nlp/cam05/000278_f.jpg'].frameIndex).toBe(22);
  expect(manifest.files.points3D).toContain('/resolve/4c18714ad982888d453ec88e2dc335f8dce5928d/reconstructions/scenes/campus_nlp/0/points3D.bin');
  await page.goto('/hub/datasets/entry/' + id);
  await expect(page.locator('main')).toContainText('285 matched views from 6 source videos');
  await expect(page.locator('main')).toContainText('18 decoded samples');
  await expect(page.locator('main')).toContainText('668 duplicate-image');
  await expect(page.locator('main')).not.toContainText('Model-only export SHA-256');
  expect(providerRequests).toEqual([]);
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

test('Dynamic Maps keeps all pose statistics and an uncropped detail preview', async ({ page }) => {
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
  const card = page.locator('.dataset-card');
  const imageBox = (await thumbnail.boundingBox())!;
  const captionBox = (await card.locator('.dataset-card-body').boundingBox())!;
  expect(Math.abs(imageBox.x - captionBox.x)).toBeLessThan(1);
  expect(Math.abs(imageBox.width - captionBox.width)).toBeLessThan(1);
  await card.getByRole('button', { name: /Metadata for/ }).click();
  await card.getByRole('link', { name: 'Full metadata', exact: true }).click();
  const preview = page.locator('.dataset-overview .dataset-thumbnail');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty('naturalWidth', 320);
  await expect(preview).toHaveJSProperty('naturalHeight', 234);
  const box = (await preview.boundingBox())!;
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

test('zero-point audit updates embedded OpenSfM and all eight NeRF companion-cloud statistics',async({page})=>{
  const index=await(await page.request.get('/hub/datasets/individual/index.json')).json() as {sources:{id:string;sourceId:string}[]};
  const expected:[string,number][]=[['hf:HaoqinHong/Physics-Informed-Deformable-Gaussian-Splatting',100000],
    ['hf:jayinnn/Skyfall-GS-datasets',35355],['hf:pkupig/dadr_splatting-dataset',100000],
    ['hf:SimeonOA/GrowSplat-Dataset',16315],['hf:uild42/gate-gsplat-assets',28634],
    ['hf:yaguchi27/EV_hw1_nerf_synthetic',100000],['hf:MikolajZ/eks_data',786432],['hf:MikolajZ/eks_demo_data',786432]];
  for(const [sourceId,points] of expected){
    const source=index.sources.find(item=>item.sourceId===sourceId)!;
    const result=await(await page.request.get('/hub/datasets/api/entries?dataset='+source.id)).json();
    expect(result.total).toBe(1);expect(result.entries[0].sceneStats.points).toBe(points);
    expect(result.entries[0].availableData.point_cloud).toMatchObject({status:'checked',count:points});
  }
  const result=await(await page.request.get('/hub/datasets/api/entries?q=Berlin')).json();
  const berlin=result.entries.find((item:{dataset:{title:string}})=>item.dataset.title.includes('OpenSfM Berlin'));
  expect(berlin.sceneStats).toEqual({cameraPoses:3,cameraModels:3,points:1430});
  expect(berlin.availableData.point_cloud).toMatchObject({status:'checked',count:1430});
  await page.goto('/hub/datasets/?q=Berlin');
  const card=page.locator('.dataset-card').filter({hasText:'OpenSfM Berlin'});
  await expect(card.locator('[data-stat="points"]')).toHaveText('1,430');
  const opened=await page.request.get(berlin.openUrl,{maxRedirects:0});expect(opened.status()).toBe(302);
  expect(new URL(opened.headers().location).searchParams.get('url')).toBe('https://raw.githubusercontent.com/mapillary/OpenSfM/92381be43cd93ca91e7ef903733a0482440028dd/data/berlin/reconstruction_example.json');
});

test('all newly bound clouds retain explicit model, photo and temporal selections',async({page})=>{
  const expected:[string,number,number][]=[['data-2e3b09ccb7812f86e4ef4d97',64,4674767],['data-e16ab11d39e7a5aff5dbfe39',4,2148],
    ['data-2cbe117bb42a638692c46147',319,69532],['data-ebfee4a083e682fe67645034',560,983145],
    ['data-ab3b0f737ecd74be64152988',477,601496],['data-f6f812cfaf2b1c7c1f5605c9',263,1051142]];
  for(const [id,poses,points] of expected){
    const response=await page.request.get('/hub/datasets/open/'+id,{maxRedirects:0});expect(response.status()).toBe(302);
    const url=new URL(new URL(response.headers().location).searchParams.get('url')!);
    expect(url.pathname).toContain('/manifests/');
    const manifest=await(await page.request.get(url.pathname)).json();
    const html=await(await page.request.get('/hub/datasets/entry/'+id)).text();
    expect(html).toContain(`data-stat="points">${points.toLocaleString('en-US')}`);expect(html).toContain(`data-stat="cameraPoses">${poses.toLocaleString('en-US')}`);
    if(manifest.format==='colmapview-camera-dataset'){
      expect(manifest.metadataUrl).toContain('/resolve/');expect(manifest.pointCloud.url).toContain('/resolve/');
      if(id==='data-e16ab11d39e7a5aff5dbfe39')expect(manifest).toMatchObject({frameIndices:[0,23,46,69],pointCloud:{format:'npz',array:'pos',frame:0}});
      if(id==='data-2cbe117bb42a638692c46147')expect(manifest.pointCloud.transform).toEqual([0,1,0,0,1,0,0,0,0,0,-1,0,0,0,0,1]);
    }else{
      expect(manifest.files.points3D).toMatch(/\/sparse\/0\/points3D\.ply$/);expect(manifest.imagesPath).toMatch(/\/multi3\/images\/$/);expect(manifest.skipImages).toBe(false);
    }
  }
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
  const dunhuang = await page.request.get('/hub/datasets/open/data-f330ea4fdfd07c8466468e10', { maxRedirects: 0 });
  expect(dunhuang.status()).toBe(302);
  const dunhuangUrl = new URL(new URL(dunhuang.headers().location).searchParams.get('url')!);
  const capture = await (await page.request.get(dunhuangUrl.pathname)).json();
  expect(capture.files.cameras).toContain('/native_ply/dunhuang/cam/sparse/0/cameras.bin');
  expect(capture.mediaArchives[0]).toMatchObject({ bytes: 11167590400, indexBytes: 52564992,
    stripPrefix: 'Dance_Dunhuang_Pair_1080/frame000000/images' });
  await page.goto('/hub/datasets/entry/data-f330ea4fdfd07c8466468e10');
  await expect(page.locator('main')).toContainText('Photos in a separate archive');
  await expect(page.locator('.dataset-thumbnail')).toHaveCount(0);
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
