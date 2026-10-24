/** Recover the publisher's 2 fps extraction correspondence; never infer it from registered-image ordinal. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { binaryPoseHeaders } from './photo-routing-records.mjs';
import { videoFrameTools } from './video-frame-tools.mjs';

const { values } = parseArgs({ options: { scratch: { type: 'string', default: '.tmp/mbzuai-video-frames-20261024' },
  'viewer-root': { type: 'string', default: '../colmap-webview' }, 'metadata-only': { type: 'boolean' },
  ffmpeg: { type: 'string', default: 'ffmpeg' }, ffprobe: { type: 'string', default: 'ffprobe' } } });
const scratch = resolve(values.scratch);
await mkdir(scratch, { recursive: true });
const tools = await videoFrameTools(values['viewer-root'], scratch);
const sourceId = 'hf:sebothetramp/MBZUAI-Campus', revision = '4c18714ad982888d453ec88e2dc335f8dce5928d';
const sourceUrl = path => `https://huggingface.co/datasets/sebothetramp/MBZUAI-Campus/resolve/${revision}/${path}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item);
const bytes = body => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
async function pinned(url, maximum = 64 * 1024 * 1024) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, url);
  assert.ok(!response.headers.get('link')?.includes('rel="next"'), 'Pinned inventory must be complete');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= maximum, 'Pinned metadata exceeds budget'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const treeUrl = `https://huggingface.co/api/datasets/sebothetramp/MBZUAI-Campus/tree/${revision}?recursive=true&expand=false&limit=1000`;
const treeBody = await pinned(treeUrl, 1024 * 1024), tree = JSON.parse(treeBody);
const root = 'reconstructions/scenes/campus_nlp/0';
const files = { cameras: `${root}/cameras.bin`, images: `${root}/images.bin`, points3d: `${root}/points3D.bin` };
const modelFiles = {}, modelBodies = {};
for (const [role, path] of Object.entries(files)) {
  const body = await pinned(sourceUrl(path)), entry = tree.find(row => row.path === path);
  assert.equal(body.length, entry.size);
  if (entry.lfs) assert.equal(hash(body), entry.lfs.oid);
  modelFiles[role] = { sourcePath: path, bytes: body.length, sha256: hash(body) };
  modelBodies[role] = body;
}
const cameras = tools.parseCamerasBinary(bytes(modelBodies.cameras));
const headers = binaryPoseHeaders(modelBodies.images);
assert.equal(headers.inspected, headers.total, 'Every registered name must be read');
const images = tools.parseImagesBinary(bytes(headers.bytes));
assert.equal(cameras.size, 6); assert.equal(images.size, 285);
const registeredImages = [...images.values()].map(image => {
  const camera = cameras.get(image.cameraId);
  return { name: image.name, cameraId: image.cameraId, width: camera.width, height: camera.height };
}).sort((a, b) => a.name.localeCompare(b.name, 'en'));
const extractor = await pinned(sourceUrl('prepare_data.py'), 64 * 1024);
assert.match(extractor.toString(), /"fps=2,scale=iw:ih"/);
assert.match(extractor.toString(), /prev_max_id \+= total_images \+ 1/);
assert.match(extractor.toString(), /"campus_nlp":\s*\{\s*'skip_start_seconds': 0,\s*'skip_end_seconds': 0/);
const baseManifest = { version: 1, baseUrl: 'https://colmapview.opsiclear.com/hub/datasets/individual/manifests/',
  files: { cameras: sourceUrl(files.cameras), images: sourceUrl(files.images), points3D: sourceUrl(files.points3d) }, skipImages: true, splats: [] };
const prepared = { sourceId, revision, kind: 'colmap', path: root,
  baseManifestSha256: hash(Buffer.from(canonical(baseManifest))), modelFiles, registeredImages,
  videos: [], bindings: [], samples: [], temporalScope: 'per_pose',
  sourceListing: { url: treeUrl, bytes: treeBody.length, sha256: hash(treeBody), complete: true },
  extractor: { sourcePath: 'prepare_data.py', bytes: extractor.length, sha256: hash(extractor) },
  recipe: { framesPerSecond: 2, skipStartSeconds: 0, skipEndSeconds: 0,
    counterScope: 'all camera folders; increment by extracted frame count plus one',
    filenameTemplate: 'native/commented publisher template: %06d_<camera>.jpg',
    proof: 'Native FFmpeg fps=2 on source-PTS-restored bounded keyframe groups, sampled separately from complete exports.' } };
let startNumber = 0;
const videoEntries = tree.filter(entry => entry.type === 'file' && /^videos\/campus_nlp\/0[0-5]\/[^/]+\.MP4$/.test(entry.path)).sort((a, b) => a.path.localeCompare(b.path, 'en'));
assert.equal(videoEntries.length, 6);
for (const entry of videoEntries) {
  const id = entry.path.split('/')[2], letter = 'abcdef'[Number(id)];
  const registered = registeredImages.filter(image => image.name.startsWith(`campus_nlp/cam${id}/`));
  const calibration = registered[0];
  const binding = { url: sourceUrl(entry.path), bytes: entry.size, frameIndex: 0, width: calibration.width, height: calibration.height };
  const signal = AbortSignal.timeout(120000), source = tools.createVideoInput(binding, signal, 16 * 1024 * 1024);
  try {
    const { track, duration } = await tools.readVideoTrack(source.input, binding, signal);
    const index = await tools.indexVideoTrack(track, signal);
    const probe = JSON.parse(execFileSync(values.ffprobe, ['-v', 'error', '-analyzeduration', '0', '-probesize', '32768',
      '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', binding.url],
    { encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 }));
    const videoProbe = probe.streams.find(stream => stream.codec_type === 'video');
    assert.equal(videoProbe.width, calibration.width); assert.equal(videoProbe.height, calibration.height);
    const formatDuration = Number(probe.format.duration), extractedCount = Math.floor(formatDuration * 2 + 0.5);
    assert.ok(extractedCount > 0 && Number.isFinite(formatDuration));
    const selected = new Map();
    for (let frameIndex = 0; frameIndex < index.length; frameIndex++) {
      // FFmpeg fps default round=near maps source PTS to the output 1/2-second time base.
      const output = Math.floor(index[frameIndex] * 2 + 0.5 + 1e-9);
      if (output >= 0 && output < extractedCount) selected.set(output, frameIndex);
    }
    assert.equal(selected.size, extractedCount, 'Each publisher extraction bin must contain a source frame');
    prepared.videos.push({ id, sourcePath: entry.path, bytes: entry.size, sha256: entry.lfs.oid,
      width: calibration.width, height: calibration.height, frameCount: index.length, duration,
      presentationIndexSha256: hash(Buffer.from(index.buffer)), codec: await track.getCodec(),
      extraction: { formatDuration, framesPerSecond: 2, extractedCount, startNumber, sourceFrameRate: videoProbe.r_frame_rate } });
    const mapped = registered.map(image => {
      const match = new RegExp(`^campus_nlp/cam${id}/(\\d{6})_${letter}\\.jpg$`).exec(image.name);
      assert.ok(match, `Unreviewed native filename: ${image.name}`);
      const output = Number(match[1]) - startNumber, frameIndex = selected.get(output);
      assert.ok(frameIndex !== undefined, `Native filename lies outside its exact publisher extraction: ${image.name}`);
      const item = { name: image.name, video: id, frameIndex, sourceTimestamp: index[frameIndex] };
      prepared.bindings.push(item);
      return { ...item, output };
    });
    console.log(JSON.stringify({ video: id, sourceFrames: index.length, duration, extractedCount, startNumber, registered: mapped.length,
      first: mapped[0], last: mapped.at(-1) }));
    if (!values['metadata-only']) {
      for (const item of [...new Map([mapped[0], mapped[Math.floor(mapped.length / 2)], mapped.at(-1)].map(item => [item.name, item])).values()]) {
        const pixelSignal = AbortSignal.timeout(120000), pixels = tools.createVideoInput(binding, pixelSignal);
        let group, first;
        try {
          const { track: pixelTrack } = await tools.readVideoTrack(pixels.input, binding, pixelSignal);
          first = await new tools.EncodedPacketSink(pixelTrack).getKeyPacket(item.sourceTimestamp, { verifyKeyPackets: true });
          group = await tools.readEncodedVideoWindow(pixelTrack, item.sourceTimestamp, 1, pixelSignal);
        } finally { pixels.dispose(); }
        const encodedPath = resolve(scratch, `sample-${id}.mp4`), pngPath = resolve(scratch, `reference-${id}-${item.output}.png`);
        await writeFile(encodedPath, group.data);
        execFileSync(values.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-copyts', '-i', encodedPath,
          '-vf', `setpts=PTS+${first.timestamp}/TB,fps=2,select=eq(pts\\,${item.output})`,
          '-frames:v', '1', '-threads', '1', pngPath], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
        const png = await readFile(pngPath);
        assert.equal(png.readUInt32BE(16), calibration.width); assert.equal(png.readUInt32BE(20), calibration.height);
        prepared.samples.push({ ...item, output: undefined, bytes: png.length, sha256: hash(png),
          referenceFile: pngPath, method: 'native_ffmpeg_fps2_from_source_pts' });
      }
    }
    startNumber += extractedCount + 1;
  } finally { source.dispose(); }
}
assert.equal(prepared.bindings.length, registeredImages.length);
await writeFile(resolve(scratch, 'prepared.json'), JSON.stringify(prepared, null, 2) + '\n');
const manifest = { ...baseManifest, version: 5, videoImages: Object.fromEntries(prepared.bindings.map(item => {
  const video = prepared.videos.find(video => video.id === item.video);
  return [item.name, { url: sourceUrl(video.sourcePath), bytes: video.bytes, frameIndex: item.frameIndex }];
})) };
delete manifest.skipImages;
const checked = tools.validateColmapManifest(manifest);
assert.ok(checked.success, checked.details);
await writeFile(resolve(scratch, 'scene.manifest.json'), JSON.stringify(checked.manifest, null, 2) + '\n');
console.log(`Prepared ${prepared.bindings.length} views from ${prepared.videos.length} sources; ${prepared.samples.length} independent reference frames. Catalog activation requires browser pixel receipts.`);
