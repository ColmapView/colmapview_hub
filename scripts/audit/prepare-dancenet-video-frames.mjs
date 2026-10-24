/** Prepare exact video bindings from pinned publisher metadata, never basename/time guesses.
 * Pixel checks are a separate browser step. This script does not activate catalog entries.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { scratch: { type: 'string', default: '.tmp/camera-video-20261023' } } });
const scratch = resolve(values.scratch);
await mkdir(scratch, { recursive: true });
const sourceId = 'hf:nyuvideolab/danceNet3D';
const scenes = JSON.parse(await readFile('data/scene-manifests.json', 'utf8')).scenes.filter(scene => scene.sourceId === sourceId);
assert.equal(scenes.length, 47, 'Recheck the complete source selection before changing its video policy');
const revision = scenes[0].revision;
const sourceUrl = path => `https://huggingface.co/datasets/nyuvideolab/danceNet3D/resolve/${revision}/${path}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const cache = new Map();
async function pinned(url, maximum = 4 * 1024 * 1024) {
  if (!cache.has(url)) cache.set(url, (async () => {
    const file = resolve(scratch, sha256(url) + '.source');
    let body;
    try { body = await readFile(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!body) {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, url);
      assert.ok(!response.headers.get('link')?.includes('rel="next"'), 'Listing must be complete');
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length; assert.ok(length <= maximum, 'Metadata exceeds its read budget'); chunks.push(chunk);
      }
      body = Buffer.concat(chunks); await writeFile(file, body);
    }
    assert.ok(body.length <= maximum);
    return body;
  })());
  return cache.get(url);
}
const receipt = (sourcePath, body) => ({ sourcePath, bytes: body.length, sha256: sha256(body) });
const readmeBody = await pinned(sourceUrl('README.md'));
assert.match(readmeBody.toString(), /at 1 fps/);
assert.match(readmeBody.toString(), /Captured at 30 fps/);
const extractorBody = await pinned(sourceUrl('video_to_images.py'));
assert.match(extractorBody.toString(), /for i, frame_id in enumerate\(frame_ids\)/);
assert.match(extractorBody.toString(), /-start_number["']\s*,\s*["']0/);
const prepared = [];
for (const scene of scenes) {
  assert.equal(scene.revision, revision);
  const frame = scene.frameGeometry, root = frame.sequencePath, sequenceName = root.split('/').at(-1);
  const sessionBody = await pinned(sourceUrl(frame.sessionManifest.sourcePath));
  assert.deepEqual(receipt(frame.sessionManifest.sourcePath, sessionBody), frame.sessionManifest);
  const sequence = JSON.parse(sessionBody).sequences[sequenceName];
  assert.equal(sequence.has_colmap, true);
  if (sequence.image_extension !== undefined) assert.equal(sequence.image_extension, '.png');
  assert.equal(new Set(sequence.frame_ids).size, sequence.frame_ids.length);
  assert.equal(sequence.frame_ids.length, frame.frameCount);
  const timestamp = sequence.frame_ids.indexOf(frame.frame);
  assert.ok(timestamp >= 0, 'Selected geometry must have a matching source video frame');
  const model = {};
  for (const role of ['cameras', 'images']) {
    model[role] = await pinned(sourceUrl(scene.modelFiles[role].sourcePath));
    assert.deepEqual(receipt(scene.modelFiles[role].sourcePath, model[role]), scene.modelFiles[role]);
  }
  const cameras = new Map(); let offset = 8;
  const cameraCount = Number(model.cameras.readBigUInt64LE());
  assert.equal(cameraCount, scene.counts.cameras);
  for (let index = 0; index < cameraCount; index++, offset += 56) {
    const id = model.cameras.readUInt32LE(offset), type = model.cameras.readInt32LE(offset + 4);
    assert.equal(type, 1, 'This policy requires the checked PINHOLE calibration');
    const width = Number(model.cameras.readBigUInt64LE(offset + 8)), height = Number(model.cameras.readBigUInt64LE(offset + 16));
    if (sequence.width !== undefined) assert.equal(width, sequence.width);
    if (sequence.height !== undefined) assert.equal(height, sequence.height);
    assert.ok(width > 0 && height > 0 && width * height <= 16000000); cameras.set(id, { width, height });
  }
  assert.equal(offset, model.cameras.length);
  const treeUrl = `https://huggingface.co/api/datasets/nyuvideolab/danceNet3D/tree/${revision}/${root}?recursive=false&expand=false&limit=1000`;
  const treeBody = await pinned(treeUrl), tree = JSON.parse(treeBody);
  const videos = []; offset = 8;
  const imageCount = Number(model.images.readBigUInt64LE());
  assert.equal(imageCount, scene.counts.images);
  for (let index = 0; index < imageCount; index++) {
    const end = model.images.indexOf(0, offset + 64); assert.ok(end > offset + 64);
    const name = model.images.toString('utf8', offset + 64, end), cameraId = name.replace(/\.png$/, '');
    assert.match(cameraId, /^\d{4}$/); assert.ok(sequence.cameras.includes(cameraId));
    const calibration = cameras.get(model.images.readUInt32LE(offset + 60)); assert.ok(calibration);
    const sourcePath = `${root}/${sequenceName}_${cameraId}.mp4`, video = tree.find(file => file.path === sourcePath);
    assert.ok(video && video.type === 'file' && video.size > 0 && /^[a-f0-9]{64}$/.test(video.lfs?.oid));
    videos.push({ name, sourcePath, bytes: video.size, sourceSha256: video.lfs.oid, timestamp, ...calibration });
    offset = end + 9 + Number(model.images.readBigUInt64LE(end + 1)) * 24;
  }
  assert.equal(offset, model.images.length);
  assert.equal(new Set(videos.map(video => video.name)).size, imageCount);
  assert.deepEqual(new Set(videos.map(video => video.name.slice(0, -4))), new Set(sequence.cameras));
  const baseName = scene.selectionSha256 + '.manifest.json';
  const baseBody = await readFile('public/hub/datasets/individual/manifests/' + baseName);
  prepared.push({ id: scene.id, sourceId, revision, kind: scene.kind, path: scene.path,
    baseManifest: { file: baseName, sha256: sha256(baseBody) }, modelFiles: scene.modelFiles,
    sessionManifest: frame.sessionManifest, readme: receipt('README.md', readmeBody), extractor: receipt('video_to_images.py', extractorBody),
    listing: { url: treeUrl, bytes: treeBody.length, sha256: sha256(treeBody), complete: true },
    frame: frame.frame, frameIds: sequence.frame_ids, frameCount: frame.frameCount, framesPerSecond: 1, timestamp, videos });
  console.log(`${prepared.length}/${scenes.length}: ${root}, ${videos.length} cameras, frame ${frame.frame} -> sample ${timestamp}`);
}
await writeFile(resolve(scratch, 'prepared.json'), JSON.stringify({ schemaVersion: 1, sourceId, revision, scenes: prepared }, null, 2) + '\n');
console.log('Prepared exact bindings; browser pixel receipts are still required.');
