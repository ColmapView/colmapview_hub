import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { videoFrameTools } from './video-frame-tools.mjs';

/** The authoring table deduplicates sources; emitted runtime bindings stay explicit. No timing is inferred. */
export function compileVideoFrameManifest(input, validate) {
  if (!input?.model || !Array.isArray(input.videos) || !Array.isArray(input.images)) throw new Error('Supply model, videos and images tables.');
  const videos = new Map();
  for (const source of input.videos) {
    if (!source.id || videos.has(source.id)) throw new Error('Video source IDs must be unique.');
    videos.set(source.id, source);
  }
  const videoImages = Object.create(null), used = new Set();
  for (const image of input.images) {
    const source = videos.get(image.video);
    if (!source || Object.hasOwn(videoImages, image.name)) throw new Error(`Missing source or duplicate registered image: ${image.name}`);
    used.add(source.id);
    videoImages[image.name] = { url: source.url, bytes: source.bytes,
      ...Object.fromEntries(['frameIndex', 'timestamp'].filter(key => Object.hasOwn(image, key)).map(key => [key, image[key]])),
      ...(source.playbackRate !== undefined && { playbackRate: source.playbackRate }) };
  }
  if (used.size !== videos.size) throw new Error('Every declared video must have a registered image binding.');
  const model = { ...input.model };
  delete model.skipImages;
  delete model.videoImages;
  const checked = validate({ ...model, version: 5, videoImages });
  if (!checked.success) throw new Error(`Invalid video manifest: ${checked.details}`);
  return checked.manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' },
    'viewer-root': { type: 'string', default: '../colmap-webview' }, scratch: { type: 'string', default: '.tmp/video-frame-authoring' } } });
  if (!values.input || !values.output) throw new Error('Use --input mapping.json --output scene.manifest.json');
  const tools = await videoFrameTools(values['viewer-root'], values.scratch);
  const manifest = compileVideoFrameManifest(JSON.parse(await readFile(values.input, 'utf8')), tools.validateColmapManifest);
  await writeFile(values.output, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Compiled ${Object.keys(manifest.videoImages).length} explicit frame bindings. Source timing and pixels require separate checks.`);
}
