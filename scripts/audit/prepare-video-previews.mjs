/** Cache one exact, reviewed video frame per published scene; never fetch videos while browsing. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile, appendFile, unlink } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { videoFrameTools } from './video-frame-tools.mjs';

const { values } = parseArgs({ options: {
  scratch: { type: 'string', default: '.tmp/video-previews' }, 'viewer-root': { type: 'string', default: '../colmap-webview' },
  ffmpeg: { type: 'string', default: 'ffmpeg' }, apply: { type: 'boolean' }, limit: { type: 'string' },
} });
const scratch = resolve(values.scratch);
await mkdir(scratch, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const readGzip = async path => JSON.parse(gunzipSync(await readFile(path)));
const policyPath = 'data/scene-contents.json.gz', original = await readFile(policyPath);
const policy = JSON.parse(gunzipSync(original));
const index = await json('public/hub/datasets/individual/index.json');
const reviews = [...(await readGzip('data/video-frame-routing.json.gz')).scenes,
  ...(await json('data/video-frame-mappings.json')).scenes];
const jobs = [];
for (const file of (await readdir('public/hub/datasets/individual/packs')).filter(file => /^\d+\.json$/.test(file))) {
  for (const row of await json('public/hub/datasets/individual/packs/' + file)) {
    const source = index.sources[row[1]], proof = row[7];
    const route = proof.videoFrameMapping || proof.videoFrameRouting;
    if (!route) continue;
    const review = reviews.find(review => review.sourceId === source.sourceId && review.kind === row[2] && review.path === row[3]);
    assert.ok(review && review.receiptSha256 === route.receiptSha256, 'Video receipt differs from the published scene');
    assert.match(review.revision, /^[a-f0-9]{40}$/);
    const sample = review.samples?.[0] || review.sample;
    const binding = review.bindings?.find(binding => binding.name === sample.name);
    const video = binding ? review.videos.find(video => video.id === binding.video) : review.videos.find(video => video.name === sample.name);
    assert.ok(video && source.sourceId.startsWith('hf:'));
    const selection = binding ? Object.fromEntries(['frameIndex', 'timestamp'].filter(key => key in binding).map(key => [key, binding[key]]))
      : { timestamp: review.timestamp };
    assert.equal(Object.keys(selection).length, 1);
    const videoFrame = { receiptSha256: review.receiptSha256, ...selection };
    const contentSource = policy.sources.find(item => item.sourceId === source.sourceId && item.revision === review.revision);
    const scene = contentSource?.scenes.find(item => item.kind === row[2] && item.path === row[3] && (item.archive ?? null) === row[5]);
    assert.ok(scene, 'Published video has no exact content record');
    if (scene.thumbnail && JSON.stringify(scene.thumbnail.videoFrame) === JSON.stringify(videoFrame)
      && scene.thumbnail.sourcePath === video.sourcePath && scene.thumbnail.sourceSha256 === (video.sourceSha256 || video.sha256)) continue;
    const url = 'https://huggingface.co/datasets/' + source.sourceId.slice(3) + '/resolve/' + review.revision + '/'
      + video.sourcePath.split('/').map(encodeURIComponent).join('/');
    const manifestName = basename(new URL(route.url).pathname);
    assert.match(manifestName, /^[a-f0-9]{64}\.manifest\.json$/);
    const manifestBody = await readFile('public/hub/datasets/individual/manifests/' + manifestName);
    assert.equal(hash(manifestBody), route.sha256);
    const declared = JSON.parse(manifestBody).videoImages?.[sample.name];
    assert.ok(declared && declared.url === url && declared.bytes === video.bytes);
    for (const key of ['frameIndex', 'timestamp']) assert.equal(declared[key], selection[key]);
    const job = { id: row[0], sourceId: source.sourceId, revision: review.revision, kind: row[2], path: row[3],
      files: scene.files, url, bytes: video.bytes, sourcePath: video.sourcePath, sourceSha256: video.sourceSha256 || video.sha256,
      width: sample.width, height: sample.height, registeredName: sample.name, videoFrame, license: source.license, attribution: source.title };
    assert.match(job.sourceSha256, /^[a-f0-9]{64}$/);
    job.fingerprint = hash(JSON.stringify(job));
    jobs.push(job);
  }
}
jobs.sort((a, b) => a.id.localeCompare(b.id));
const limit = values.limit === undefined ? jobs.length : Number(values.limit);
assert.ok(Number.isSafeInteger(limit) && limit >= 0);
const selected = jobs.slice(0, limit);
console.log(JSON.stringify({ publishedVideoScenes: reviews.length, missing: jobs.length, preparing: selected.length }));
const tools = await videoFrameTools(values['viewer-root'], scratch);
const receipts = resolve(scratch, 'results.jsonl'), prior = new Map();
try { for (const line of (await readFile(receipts, 'utf8')).split('\n').filter(Boolean)) {
  const result = JSON.parse(line); if (!result.error) prior.set(result.fingerprint, result);
} } catch (error) { if (error.code !== 'ENOENT') throw error; }
const results = [];
async function prepare(job) {
  const cached = prior.get(job.fingerprint);
  if (cached) {
    const body = await readFile(resolve(scratch, cached.thumbnail.file));
    assert.equal(hash(body) + '.jpg', cached.thumbnail.file);
    return cached;
  }
  const groupPath = resolve(scratch, job.id + '.mp4'), pngPath = resolve(scratch, job.id + '.png');
  const jpgPath = resolve(scratch, job.id + '.jpg');
  const signal = AbortSignal.timeout(180000);
  const binding = { url: job.url, bytes: job.bytes, width: job.width, height: job.height, ...job.videoFrame };
  const source = tools.createVideoInput(binding, signal, 96 * 1024 * 1024);
  let group, timestamp;
  try {
    const { track } = await tools.readVideoTrack(source.input, binding, signal);
    timestamp = job.videoFrame.timestamp;
    if (timestamp === undefined) {
      const index = await tools.indexVideoTrack(track, signal);
      assert.ok(job.videoFrame.frameIndex < index.length);
      timestamp = index[job.videoFrame.frameIndex];
    }
    group = await tools.readEncodedVideoWindow(track, timestamp, 1, signal);
  } finally { source.dispose(); }
  try {
    await writeFile(groupPath, group.data);
    execFileSync(values.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-threads', '1', '-flags2', '+showall', '-i', groupPath,
      '-vf', `select=gte(t\\,0),select=eq(n\\,${group.frameIndex})`, '-fps_mode', 'passthrough', '-frames:v', '1',
      '-threads', '1', pngPath], { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
    const png = await readFile(pngPath);
    assert.equal(png.readUInt32BE(16), job.width); assert.equal(png.readUInt32BE(20), job.height);
    execFileSync(values.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-i', pngPath, '-vf', 'scale=320:320:force_original_aspect_ratio=decrease',
      '-frames:v', '1', '-q:v', '5', '-threads', '1', jpgPath], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
    const jpeg = await readFile(jpgPath);
    assert.ok(jpeg.length > 0 && jpeg.length <= 65536 && jpeg.subarray(0, 3).equals(Buffer.from([255, 216, 255])));
    const name = hash(jpeg) + '.jpg'; await writeFile(resolve(scratch, name), jpeg);
    const width = job.width >= job.height ? 320 : Math.round(job.width * 320 / job.height);
    const height = job.height >= job.width ? 320 : Math.round(job.height * 320 / job.width);
    const thumbnail = { file: name, sourcePath: job.sourcePath, sourceSha256: job.sourceSha256, width, height,
      originalWidth: job.width, originalHeight: job.height, crop: 'aspect_fit', datasetLicense: job.license,
      license: job.license, attribution: job.attribution, registeredName: job.registeredName, videoFrame: job.videoFrame };
    const result = { ...job, timestamp, thumbnail, decodedFrameSha256: hash(png), encodedGroupBytes: group.data.length, jpegBytes: jpeg.length };
    await appendFile(receipts, JSON.stringify(result) + '\n');
    return result;
  } finally {
    // Only this job's transient remux and full-resolution frame; retain the small JPEG and receipt.
    await Promise.all([groupPath, pngPath, jpgPath].map(path => unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; })));
  }
}
let next = 0;
await Promise.all(Array.from({ length: Math.min(2, selected.length) }, async () => {
  while (next < selected.length) {
    const job = selected[next++];
    try { results.push(await prepare(job)); console.log(JSON.stringify({ prepared: results.length, total: selected.length, scene: job.path })); }
    catch (error) { results.push({ id: job.id, error: error.message }); console.error(job.path + ': ' + error.message); }
  }
}));
await writeFile(resolve(scratch, 'prepared.json'), JSON.stringify(results, null, 2) + '\n');
assert.ok(results.every(result => !result.error), 'Some video previews failed; the catalog policy was not changed');
if (values.apply && results.length) {
  assert.ok((await readFile(policyPath)).equals(original), 'Content policy changed during preview preparation');
  const directory = resolve('data/scene-thumbnails'); await mkdir(directory, { recursive: true });
  for (const result of results) {
    const source = policy.sources.find(source => source.sourceId === result.sourceId && source.revision === result.revision);
    const scene = source.scenes.find(scene => scene.kind === result.kind && scene.path === result.path);
    assert.deepEqual(scene.files, result.files);
    const body = await readFile(resolve(scratch, result.thumbnail.file)); assert.equal(hash(body) + '.jpg', result.thumbnail.file);
    await writeFile(resolve(directory, result.thumbnail.file), body); scene.thumbnail = result.thumbnail;
  }
  policy.checkedAt = new Date().toISOString();
  await writeFile(policyPath, gzipSync(Buffer.from(JSON.stringify(policy)), { mtime: 0 }));
}
console.log(JSON.stringify({ prepared: results.length, applied: Boolean(values.apply), jpegBytes: results.reduce((sum, result) => sum + result.jpegBytes, 0) }));
