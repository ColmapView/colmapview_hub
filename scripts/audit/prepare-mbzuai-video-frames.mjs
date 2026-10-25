/** Recover the pinned publisher's extraction correspondence, never registered-image ordinal. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pinnedModelFiles } from './native-pose-stream.mjs';
import { extractionFrames, mbzuaiRecipes, nativeCaptureName } from './mbzuai-extraction.mjs';
import { videoFrameTools } from './video-frame-tools.mjs';

const { values } = parseArgs({ options: {
  scratch: { type: 'string', default: '.tmp/mbzuai-video-frames' },
  cache: { type: 'string' }, model: { type: 'string', default: 'reconstructions/scenes/campus_nlp/0' },
  'allow-partial': { type: 'boolean' }, 'viewer-root': { type: 'string', default: '../colmap-webview' },
  'metadata-only': { type: 'boolean' }, ffmpeg: { type: 'string', default: 'ffmpeg' }, ffprobe: { type: 'string', default: 'ffprobe' },
} });
const scratch = resolve(values.scratch), cache = resolve(values.cache || resolve(scratch, 'cache'));
await mkdir(scratch, { recursive: true }); await mkdir(cache, { recursive: true });
// A failed new preparation must not leave a previously activatable draft behind.
for (const file of ['prepared.json', 'scene.manifest.json']) {
  try { await unlink(resolve(scratch, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const tools = await videoFrameTools(values['viewer-root'], scratch);
const sourceId = 'hf:sebothetramp/MBZUAI-Campus', revision = '4c18714ad982888d453ec88e2dc335f8dce5928d';
const sourceUrl = path => `https://huggingface.co/datasets/sebothetramp/MBZUAI-Campus/resolve/${revision}/${path}`;
const hash = body => createHash('sha256').update(body).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item);
const bytes = body => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
const bindingOnly = item => ({ name: item.name, video: item.video, frameIndex: item.frameIndex, sourceTimestamp: item.sourceTimestamp });
async function pinned(url, maximum) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  assert.equal(response.status, 200, url);
  assert.ok(!response.headers.get('link')?.includes('rel="next"'), 'Pinned inventory must be complete');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= maximum, 'Pinned metadata exceeds budget'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const treeUrl = `https://huggingface.co/api/datasets/sebothetramp/MBZUAI-Campus/tree/${revision}?recursive=true&expand=false&limit=1000`;
const treeBody = await pinned(treeUrl, 1024 * 1024), tree = JSON.parse(treeBody), root = values.model;
assert.ok(!root.startsWith('/') && !root.split('/').includes('..'));
const files = { cameras: `${root}/cameras.bin`, images: `${root}/images.bin`, points3d: `${root}/points3D.bin` };
const { bodies, receipts: modelFiles } = await pinnedModelFiles(files, tree, sourceUrl, cache);
const cameras = tools.parseCamerasBinary(bytes(bodies.cameras)), images = tools.parseImagesBinary(bytes(bodies.images));
assert.equal(images.size, Number(bodies.images.readBigUInt64LE(0)), 'Native image IDs must be unique');
const registeredImages = [...images.values()].map(image => {
  const camera = cameras.get(image.cameraId); assert.ok(camera, 'Registered pose needs its native camera');
  return { name: image.name, cameraId: image.cameraId, width: camera.width, height: camera.height };
}).sort((a, b) => a.name.localeCompare(b.name, 'en'));
const extractor = await pinned(sourceUrl('prepare_data.py'), 64 * 1024), recipes = mbzuaiRecipes(extractor.toString());
const baseManifest = { version: 1, baseUrl: 'https://colmapview.opsiclear.com/hub/datasets/individual/manifests/',
  files: { cameras: sourceUrl(files.cameras), images: sourceUrl(files.images), points3D: sourceUrl(files.points3d) }, skipImages: true, splats: [] };
const prepared = { sourceId, revision, kind: 'colmap', path: root,
  baseManifestSha256: hash(Buffer.from(canonical(baseManifest))), modelFiles, registeredImages,
  videos: [], bindings: [], samples: [], temporalScope: 'per_pose', captureType: 'unclassified',
  sourceListing: { url: treeUrl, bytes: treeBody.length, sha256: hash(treeBody), complete: true },
  extractor: { sourcePath: 'prepare_data.py', bytes: extractor.length, sha256: hash(extractor) },
  recipe: { framesPerSecond: 2, captures: {}, counterScope: 'per capture; all sorted camera folders; extracted count plus one',
    filenameTemplate: 'native publisher templates: %06d_<camera>.jpg or %06d<camera>.jpg',
    proof: 'Independent native FFmpeg seek/trim/fps=2 references from source-PTS-restored bounded keyframe groups.' },
  unmapped: [], unresolvedCaptures: [] };

async function videoIndex(entry, calibration) {
  const key = resolve(cache, entry.lfs.oid + '.video.json');
  try {
    const prior = JSON.parse(await readFile(key));
    assert.equal(prior.sourceSha256, entry.lfs.oid); assert.equal(prior.bytes, entry.size);
    assert.equal(prior.extractorSha256, prepared.extractor.sha256);
    assert.equal(prior.indexSha256, hash(Buffer.from(new Float64Array(prior.timestamps).buffer)));
    assert.equal(prior.width, calibration.width); assert.equal(prior.height, calibration.height);
    return prior;
  } catch {
    const binding = { url: sourceUrl(entry.path), bytes: entry.size, frameIndex: 0, width: calibration.width, height: calibration.height };
    const signal = AbortSignal.timeout(120000), source = tools.createVideoInput(binding, signal, 16 * 1024 * 1024);
    try {
      const { track, duration } = await tools.readVideoTrack(source.input, binding, signal);
      const timestamps = await tools.indexVideoTrack(track, signal);
      const probe = JSON.parse(execFileSync(values.ffprobe, ['-v', 'error', '-analyzeduration', '0', '-probesize', '32768',
        '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', binding.url],
      { encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 }));
      const stream = probe.streams.find(stream => stream.codec_type === 'video');
      const result = { sourceSha256: entry.lfs.oid, bytes: entry.size, extractorSha256: prepared.extractor.sha256,
        indexSha256: hash(Buffer.from(timestamps.buffer)), timestamps: [...timestamps], duration,
        formatDuration: Number(probe.format.duration), width: stream.width, height: stream.height,
        sourceFrameRate: stream.r_frame_rate, codec: await track.getCodec() };
      await writeFile(key, JSON.stringify(result) + '\n'); return result;
    } finally { source.dispose(); }
  }
}

const captures = [...new Set(registeredImages.map(image => nativeCaptureName(image.name)?.capture).filter(Boolean))];
for (const capture of captures) {
  const checkpoint = [prepared.videos.length, prepared.bindings.length, prepared.samples.length];
  try {
    const recipe = recipes.get(capture);
    // A spelling/capture alias needs separate publisher evidence; never normalize it into a match.
    const entries = tree.filter(entry => entry.type === 'file' && entry.path.startsWith(`videos/${capture}/`)
      && /^videos\/[^/]+\/(?:0[0-5]|core01)\/[^/]+\.(?:mp4|mov|avi|mkv)$/i.test(entry.path)).sort((a, b) => a.path.localeCompare(b.path, 'en'));
    if (!recipe || !entries.length) continue;
    assert.equal(new Set(entries.map(entry => entry.path.split('/')[2])).size, entries.length, 'Ambiguous source clips per camera');
    prepared.recipe.captures[capture] = recipe;
    let startNumber = 0;
    for (const entry of entries) {
      const camera = entry.path.split('/')[2], id = `${capture}/${camera}`;
      const native = registeredImages.filter(image => {
        const name = nativeCaptureName(image.name); return name?.capture === capture && name.camera === camera;
      });
      const calibration = native[0] || registeredImages.find(image => nativeCaptureName(image.name)?.capture === capture);
      const metadata = await videoIndex(entry, calibration), index = Float64Array.from(metadata.timestamps);
      const { count, selected } = extractionFrames(index, metadata.formatDuration, recipe, metadata.duration);
      const mapped = native.map(image => {
        assert.equal(image.width, metadata.width); assert.equal(image.height, metadata.height);
        const output = nativeCaptureName(image.name).number - startNumber, frameIndex = selected.get(output);
        assert.ok(frameIndex !== undefined, `Native filename lies outside its publisher extraction: ${image.name}`);
        return { name: image.name, video: id, frameIndex, sourceTimestamp: index[frameIndex], output };
      });
      if (mapped.length) {
        prepared.videos.push({ id, sourcePath: entry.path, bytes: entry.size, sha256: entry.lfs.oid,
          width: metadata.width, height: metadata.height, frameCount: index.length, duration: metadata.duration,
          presentationIndexSha256: metadata.indexSha256, codec: metadata.codec,
          extraction: { ...recipe, formatDuration: metadata.formatDuration, framesPerSecond: 2, extractedCount: count,
            startNumber, sourceFrameRate: metadata.sourceFrameRate } });
        prepared.bindings.push(...mapped.map(bindingOnly));
        if (!values['metadata-only']) {
          const samples = [...new Map([mapped[0], mapped[Math.floor(mapped.length / 2)], mapped.at(-1)].map(item => [item.name, item])).values()];
          for (const item of samples) {
            const key = hash(Buffer.from(canonical({ source: entry.lfs.oid, selector: item.frameIndex, recipe })));
            const pngPath = resolve(cache, key + '.png'), receiptPath = resolve(cache, key + '.reference.json');
            let png;
            try { const receipt = JSON.parse(await readFile(receiptPath)); png = await readFile(pngPath); assert.equal(hash(png), receipt.sha256); }
            catch {
              const signal = AbortSignal.timeout(120000), source = tools.createVideoInput({ url: sourceUrl(entry.path), bytes: entry.size }, signal);
              let group, first;
              try {
                const { track } = await tools.readVideoTrack(source.input, metadata, signal);
                first = await new tools.EncodedPacketSink(track).getKeyPacket(item.sourceTimestamp, { verifyKeyPackets: true });
                group = await tools.readEncodedVideoWindow(track, item.sourceTimestamp, 1, signal);
              } finally { source.dispose(); }
              const encodedPath = resolve(scratch, 'reference-group.mp4');
              await writeFile(encodedPath, group.data);
              try {
                execFileSync(values.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-copyts', '-i', encodedPath,
                  '-vf', `setpts=PTS+(${first.timestamp}-${recipe.skipStartSeconds})/TB,trim=start=0:end=${metadata.formatDuration - recipe.skipStartSeconds - recipe.skipEndSeconds},fps=2,select=eq(pts\\,${item.output})`,
                  '-frames:v', '1', '-threads', '1', pngPath], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
                png = await readFile(pngPath);
                await writeFile(receiptPath, JSON.stringify({ sha256: hash(png), sourceSha256: entry.lfs.oid, frameIndex: item.frameIndex, recipe }));
              } finally { await unlink(encodedPath); }
            }
            assert.equal(png.readUInt32BE(16), metadata.width); assert.equal(png.readUInt32BE(20), metadata.height);
            prepared.samples.push({ ...bindingOnly(item), bytes: png.length, sha256: hash(png), referenceFile: pngPath, method: 'native_ffmpeg_fps2_from_source_pts' });
          }
        }
      }
      console.log(JSON.stringify({ capture, camera, sourceFrames: index.length, count, startNumber, mapped: mapped.length }));
      startNumber += count + 1;
    }
  } catch (error) {
    // A different recipe for one capture cannot qualify its earlier camera bins.
    // Other independently established captures may still supply partial imagery.
    prepared.videos.length = checkpoint[0]; prepared.bindings.length = checkpoint[1]; prepared.samples.length = checkpoint[2];
    delete prepared.recipe.captures[capture];
    if (!values['allow-partial']) throw error;
    prepared.unresolvedCaptures.push({ capture, reason: 'publisher_recipe_or_frame_check_failed' });
    console.log(JSON.stringify({ capture, omitted: String(error) }));
  }
}
const bound = new Set(prepared.bindings.map(binding => binding.name));
const imageByName = new Map([...images.values()].map(image => [image.name, image]));
prepared.captureEvidence = { distinctNativeCentersByVideo: {} };
for (const video of prepared.videos) {
  const centers = prepared.bindings.filter(binding => binding.video === video.id).map(binding => {
    const { qvec: [w, x, y, z], tvec: [tx, ty, tz] } = imageByName.get(binding.name);
    // COLMAP camera center = -R^T t, not the world-to-camera translation.
    const center = [-(1 - 2 * (y * y + z * z)) * tx - 2 * (x * y + z * w) * ty - 2 * (x * z - y * w) * tz,
      -2 * (x * y - z * w) * tx - (1 - 2 * (x * x + z * z)) * ty - 2 * (y * z + x * w) * tz,
      -2 * (x * z + y * w) * tx - 2 * (y * z - x * w) * ty - (1 - 2 * (x * x + y * y)) * tz];
    assert.ok(center.every(Number.isFinite));
    return center.map(value => value.toFixed(6)).join(',');
  });
  prepared.captureEvidence.distinctNativeCentersByVideo[video.id] = new Set(centers).size;
}
if (Object.values(prepared.captureEvidence.distinctNativeCentersByVideo).some(count => count > 1)) prepared.captureType = 'moving_camera';
prepared.unmapped = registeredImages.filter(image => !bound.has(image.name)).map(image => image.name);
assert.ok(prepared.bindings.length, 'No publisher-established video mappings for this selection');
assert.ok(values['allow-partial'] || !prepared.unmapped.length, 'Unmapped names require an explicit --allow-partial review');
await writeFile(resolve(scratch, 'prepared.json'), JSON.stringify(prepared, null, 2) + '\n');
const manifest = { ...baseManifest, version: 5, videoImages: Object.fromEntries(prepared.bindings.map(item => {
  const video = prepared.videos.find(video => video.id === item.video);
  return [item.name, { url: sourceUrl(video.sourcePath), bytes: video.bytes, frameIndex: item.frameIndex }];
})) };
delete manifest.skipImages;
const checked = tools.validateColmapManifest(manifest); assert.ok(checked.success, checked.details);
await writeFile(resolve(scratch, 'scene.manifest.json'), JSON.stringify(checked.manifest, null, 2) + '\n');
console.log(`Prepared ${prepared.bindings.length}/${registeredImages.length} views, ${prepared.samples.length} independent references. Activation requires browser pixel receipts.`);
