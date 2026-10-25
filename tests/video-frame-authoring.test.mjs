import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileVideoFrameManifest } from '../scripts/audit/compile-video-frame-manifest.mjs';
import { extractionFrames, nativeCaptureName, mbzuaiRecipes } from '../scripts/audit/mbzuai-extraction.mjs';

test('source tables compile into explicit frame bindings without filename or FPS inference', () => {
  const input = { model: { version: 1, baseUrl: 'https://data.test/', files: { cameras: 'cameras.bin', images: 'images.bin' }, skipImages: true },
    videos: [{ id: 'a', url: 'camera.mp4', bytes: 300000000 }],
    images: [{ name: 'cam/004242_a.jpg', video: 'a', frameIndex: 240 }, { name: 'cam/other.jpg', video: 'a', timestamp: 0.25 }] };
  const validate = manifest => ({ success: true, manifest });
  const result = compileVideoFrameManifest(input, validate);
  assert.equal(result.version, 5); assert.equal(result.skipImages, undefined);
  assert.deepEqual(result.videoImages['cam/004242_a.jpg'], { url: 'camera.mp4', bytes: 300000000, frameIndex: 240 });
  assert.equal(result.videoImages['cam/other.jpg'].timestamp, 0.25);
  assert.equal(input.model.skipImages, true);
  assert.throws(() => compileVideoFrameManifest({ ...input, images: [...input.images, input.images[0]] }, validate), /duplicate/);
  assert.throws(() => compileVideoFrameManifest(input, () => ({ success: false, details: 'bad selector' })), /bad selector/);
});

test('a documented trim recipe cannot qualify a contradictory capture through a small subset', () => {
  const source = `"fps=2,scale=iw:ih"\nprev_max_id += total_images + 1\n"-ss", f"{skip_start}"\n"-t", f"{duration_to_keep}"\nconfig = {
    "campus_knowledge_center": { 'skip_start_seconds': 0, 'skip_end_seconds': 0 },
    "hydro_NLP_connection": { 'skip_start_seconds': 6, 'skip_end_seconds': 7 },
}`;
  const recipes = mbzuaiRecipes(source);
  assert.deepEqual(recipes.get('campus_knowledge_center'), { skipStartSeconds: 0, skipEndSeconds: 0 });
  assert.equal(recipes.has('hydro_NLP_connection'), false);
});

test('publisher extraction trims before rounding and keeps source presentation indices', () => {
  const index = Float64Array.from({ length: 100 }, (_, frame) => frame / 10);
  const { count, selected } = extractionFrames(index, 10, { skipStartSeconds: 3, skipEndSeconds: 2 });
  assert.equal(count, 10); assert.equal(selected.get(0), 32); assert.equal(selected.get(9), 77);
  assert.throws(() => extractionFrames(Float64Array.from([0, 3, 9]), 10,
    { skipStartSeconds: 3, skipEndSeconds: 2 }), /Incomplete/);
  const short = Float64Array.from({ length: 726 }, (_, frame) => frame * 1001 / 30000);
  assert.equal(extractionFrames(short, 24.257, { skipStartSeconds: 0, skipEndSeconds: 0 }, 24.2242).count, 48);
});

test('native camera namespaces retain global output numbers and reject suffix guesses', () => {
  assert.deepEqual(nativeCaptureName('campus_knowledge_center/cam01/000059_b.jpg'),
    { capture: 'campus_knowledge_center', camera: '01', number: 59 });
  assert.deepEqual(nativeCaptureName('campus_core/camcore01/000551core.jpg'),
    { capture: 'campus_core', camera: 'core01', number: 551 });
  assert.deepEqual(nativeCaptureName('campus_core/core01/000551_core.jpg'),
    { capture: 'campus_core', camera: 'core01', number: 551 });
  assert.equal(nativeCaptureName('campus_core/cam00/000551_b.jpg'), null);
  assert.equal(nativeCaptureName('frame_00001.png'), null);
});
