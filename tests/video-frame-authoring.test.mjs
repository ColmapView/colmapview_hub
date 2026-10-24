import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileVideoFrameManifest } from '../scripts/audit/compile-video-frame-manifest.mjs';

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
