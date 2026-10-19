// Offline operator audit of pinned inventories and bounded model responses.
// No source requests or catalog edits: a separate validator publishes reviews.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { binaryPoseHeaders, completeTextPrefix, photoRoutingInventory } from './photo-routing-records.mjs';

const { values } = parseArgs({ options: {
  input: { type: 'string' }, output: { type: 'string' }, 'viewer-root': { type: 'string', default: '../colmap-webview' },
  scratch: { type: 'string', default: '.tmp/photo-routing' },
} });
if (!values.input || !values.output) throw new Error('Required: --input prepared-inventory.json --output reviews.json');
const viewer = resolve(values['viewer-root']), scratch = resolve(values.scratch);
const viewerCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: viewer, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(viewerCommit)
    || execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: viewer, encoding: 'utf8' }).trim()) {
  throw new Error('Audit requires committed viewer dependencies');
}
const viewerVersion = JSON.parse(await readFile(resolve(viewer, 'package.json'), 'utf8')).version;
await mkdir(scratch, { recursive: true });
const bundle = resolve(scratch, 'viewer-tools.mjs');
const exports = {
  'src/dataset/nativeMedia.ts': ['prepareNativeMedia', 'rememberNativeMediaSource'],
  'src/dataset/nativeMediaPaths.ts': ['NativeMediaPathIndex'],
  'src/parsers/cameras.ts': ['parseCamerasBinary', 'parseCamerasText'],
  'src/parsers/images.ts': ['parseImagesBinary', 'parseImagesText'],
  'src/utils/imageMappingCsvResolver.ts': ['parseImageMappingCsv'],
  'src/dataset/importers/sourcePaths.ts': ['imageResourceUrl'],
  'src/utils/imageFileLookupPolicy.ts': ['isAuxiliaryImagePath', 'isDatasetMaskImagePath'],
  'src/hooks/urlLoaderManifestFetch.ts': ['fetchManifestColmapFiles'],
  'src/utils/manifestValidation.ts': ['validateColmapManifest'],
};
await build({ stdin: { contents: Object.entries(exports).map(([file, names]) =>
  `export {${names}} from ${JSON.stringify(resolve(viewer, file))};`).join('\n'), resolveDir: viewer, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: bundle,
  plugins: [{ name: 'offline-only', setup(b) {
    b.onResolve({ filter: /fetchDatasetResource$/ }, () => ({ path: 'transport', namespace: 'audit' }));
    b.onLoad({ filter: /.*/, namespace: 'audit' }, () => ({ contents:
      'export const fetchDatasetResource=()=>{throw new Error("Unexpected network read in offline audit")};export const fetchDatasetRequest=fetchDatasetResource;', loader: 'js' }));
  } }],
});
const api = await import(pathToFileURL(bundle).href);
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const inputBytes = await readFile(values.input), input = JSON.parse(inputBytes);
if (input.schemaVersion !== 1 || !Array.isArray(input.scenes)) throw new Error('Invalid routing audit input');
const scenes = [], failures = [];
const checkedAt = new Date().toISOString();
const arrayBuffer = body => body.buffer.slice(body.byteOffset, body.byteOffset + body.length);
const safePath = path => typeof path === 'string' && path.length > 0 && !path.startsWith('/')
  && !/[\\?#]/.test(path) && ![...path].some(character => character.charCodeAt(0) <= 31)
  && path.split('/').every(part => part && part !== '.' && part !== '..');
const isPhoto = path => safePath(path) && /\.(?:jpe?g|png|webp|bmp|tiff?)$/i.test(path)
  && !path.split('/').some(part => part.startsWith('._') || part === '__MACOSX');

for (const row of input.scenes) {
  try {
    if (!row.sourceId.startsWith('hf:') || !/^[a-f0-9]{40}$/.test(row.revision)
        || !['colmap', 'cameras'].includes(row.kind) || row.inventoryComplete !== true) throw new Error('Incomplete pinned native inventory');
    const repo = row.sourceId.slice(3).split('/').map(encodeURIComponent).join('/');
    const root = `https://huggingface.co/datasets/${repo}/resolve/${row.revision}/`;
    const url = path => root + path.split('/').map(encodeURIComponent).join('/');
    const physical = path => {
      if (!path.startsWith(root)) return path;
      return path.slice(root.length).split('/').map(decodeURIComponent).join('/');
    };
    const read = async role => {
      const receipt = row.modelReceipts[role];
      if (!receipt || receipt.path !== row.files[role] || receipt.url !== url(receipt.path)) throw new Error(`Missing pinned ${role} receipt`);
      const body = await readFile(receipt.file);
      if (body.length !== receipt.bytes || hash(body) !== receipt.sha256
          || receipt.entire && receipt.bytes !== receipt.sourceBytes) throw new Error(`Changed ${role} response bytes`);
      return body;
    };
    if (!row.modelReceipts.cameras?.entire) throw new Error('Complete camera calibration unavailable');
    const cameraBody = await read('cameras'), poseBody = await read('images');
    const cameras = row.files.cameras.endsWith('.bin') ? api.parseCamerasBinary(arrayBuffer(cameraBody)) : api.parseCamerasText(cameraBody.toString('utf8'));
    let images, registered = row.registered;
    if (row.files.images.endsWith('.bin')) {
      const prefix = binaryPoseHeaders(poseBody);
      if (registered !== null && registered !== prefix.total) throw new Error('Native pose count changed');
      registered = prefix.total;
      images = api.parseImagesBinary(arrayBuffer(prefix.bytes), true);
      if (images.size !== prefix.inspected) throw new Error('Duplicate native pose IDs');
    } else {
      images = api.parseImagesText(completeTextPrefix(poseBody, row.modelReceipts.images.entire), true);
      if (row.modelReceipts.images.entire) {
        if (registered !== null && registered !== images.size) throw new Error('Complete text pose count changed');
        registered = images.size;
      }
    }
    const complete = registered === images.size;
    if (!images.size || new Set([...images.values()].map(image => image.name)).size !== images.size
        || [...images.values()].some(image => !safePath(image.name) || !cameras.has(image.cameraId))) throw new Error('Invalid or unsupported registered names or camera references');
    const { photos, masks, physicalPaths } = photoRoutingInventory(row, {
      isPhoto, isAuxiliaryImagePath: api.isAuxiliaryImagePath, isDatasetMaskImagePath: api.isDatasetMaskImagePath,
      ownership: paths => {
        const index = new api.NativeMediaPathIndex(paths, row.path, { baseUrl: root, role: 'photo' });
        return path => index.isScenePhoto(path);
      },
    });
    const index = new api.NativeMediaPathIndex(physicalPaths, row.path, { baseUrl: root });
    const overrides = {};
    const companions = row.companions.filter(item => !item.truncated && item.text && [200, 206].includes(item.status)
      && ['*', 'https://colmapview.opsiclear.com'].includes(item.corsOrigin));
    const mappingReceipts = [];
    const mappingReceipt = item => ({ path: item.path, kind: item.kind, url: item.url, sha256: hash(Buffer.from(item.text)), complete: true });
    const csvs = companions.filter(item => item.kind === 'image_mapping_csv');
    if (csvs.length > 1) throw new Error('Ambiguous authoritative CSV mapping');
    if (csvs.length) {
      mappingReceipts.push(mappingReceipt(csvs[0]));
      for (const [name, target] of Object.entries(api.parseImageMappingCsv(csvs[0].text))) {
        const match = index.image(name, target);
        if (match.status === 'resolved' && photos.includes(match.path)) overrides[name] = match.path;
      }
    }
    if (row.originalPolicy === 'authoritative_json_mapping_required') {
      const mapping = companions.filter(item => item.kind === 'armgs_mapping');
      const manifests = companions.filter(item => item.kind === 'armgs_manifest');
      if (mapping.length !== 1 || manifests.length !== 1) throw new Error('Missing authoritative mapping/manifest pair');
      mappingReceipts.push(mappingReceipt(mapping[0]), mappingReceipt(manifests[0]));
      const frames = JSON.parse(manifests[0].text).frames;
      const paired = new Map(frames.map(frame => [JSON.stringify([frame.channel, frame.frame_index]), frame.image_path]));
      if (paired.size !== frames.length) throw new Error('Duplicate authoritative frame keys');
      for (const frame of JSON.parse(mapping[0].text).frames) {
        const original = frame.original_image_path, marker = '/data/waymo_prepared_3cam_native/';
        if (paired.get(JSON.stringify([frame.camera_channel, frame.frame_index])) !== original || !original.includes(marker)) throw new Error('Authoritative mappings disagree');
        const path = original.slice(original.indexOf(marker) + 1);
        if (!photos.includes(path) || !safePath(frame.image_name)) throw new Error('Unlisted authoritative photograph');
        overrides[frame.image_name] = path;
      }
    }
    // An existing role/collection review is required before auxiliary images
    // can become photographs. A matching filename alone does not establish it.
    if (['explicit_photo_role_or_collection_required', 'authoritative_manifest_companion_images'].includes(row.originalPolicy)
        && !row.photoCollection) throw new Error('Photograph role or association needs review');
    if (row.mediaDeclared) {
      const declared = new api.NativeMediaPathIndex(photos, row.path, { baseUrl: root, role: 'photo' });
      for (const image of images.values()) {
        if (Object.hasOwn(overrides, image.name)) continue;
        const match = declared.image(image.name);
        if (match.status === 'resolved') overrides[image.name] = match.path;
      }
    }
    const run = async (baseUrl, hint) => {
      const file = new File([cameraBody], row.files.cameras.split('/').at(-1));
      const files = new Map([[row.files.cameras, file]]), prompts = [];
      api.rememberNativeMediaSource(files, { source: { kind: 'url', baseUrl }, ...hint });
      const context = await api.prepareNativeMedia(files, file, cameras, images, undefined, { selectPhotos: async candidates => {
        prompts.push(candidates);
        return candidates.find(candidate => candidate.sceneRoot === row.photoCollection)
          ?? candidates.find(candidate => candidate.path === 'photos:keep');
      } });
      return { context, prompts };
    };
    const original = await run(root, { modelDir: row.path, paths: physicalPaths, imagePaths: photos, maskPaths: masks, overrides });
    const sampleCandidates = [...images.values()].filter(image => original.context?.bindings.get(image.name)?.sourceImagePath === row.sample.path
      && (!row.sample.name || row.sample.name === image.name));
    const sample = sampleCandidates.length === 1 ? sampleCandidates[0] : undefined;
    if (!sample || original.context?.bindings.get(sample.name)?.sourceImagePath !== row.sample.path) throw new Error('Checked registered sample not bound by current loader');
    const camera = cameras.get(sample.cameraId);
    if (camera.width !== row.sample.width || camera.height !== row.sample.height) throw new Error(`Sample photograph dimensions ${row.sample.width}x${row.sample.height} differ from calibration ${camera.width}x${camera.height}`);
    // Keep every source-declared CSV/JSON association, including names outside
    // the inspected native prefix. Otherwise a manifest would suppress the CSV
    // discovery needed by later renamed registered images.
    const names = { ...overrides, ...Object.fromEntries([...original.context.bindings].map(([name, binding]) => [name, physical(binding.sourceImagePath)])) };
    if (Object.entries(names).some(([name, path]) => !safePath(name) || !photos.includes(path))) throw new Error('Loader selected an undeclared photograph or unsafe name');
    // Preserve model/scene scope for splat and optional settings discovery.
    // Exact URL overrides allow sibling photos without selecting another model.
    const baseUrl = url(row.scope).replace(/\/?$/, '/');
    const relative = path => row.scope ? path.startsWith(row.scope + '/') ? path.slice(row.scope.length + 1) : url(path) : path;
    const manifest = { version: 1, baseUrl, files: Object.fromEntries(
      [['cameras', 'cameras'], ['images', 'images'], ['points3D', 'points3d'], ['rigs', 'rigs'], ['frames', 'frames']]
        .filter(([, role]) => row.files[role]).map(([role, key]) => [role, url(row.files[key])])),
      images: photos.map(relative), masks: masks.map(relative),
      imageNameToPath: Object.fromEntries(Object.entries(names).map(([name, path]) => [name, relative(path)])) };
    const validated = api.validateColmapManifest(manifest);
    if (!validated.success) throw new Error('Released manifest schema rejected the selection: ' + validated.details);
    const requested = new Set();
    const files = await api.fetchManifestColmapFiles(validated.manifest, { setUrlProgress: () => {}, log: () => {}, fetchFile: async (base, path) => {
      if (base !== baseUrl || !Object.values(manifest.files).includes(path)) throw new Error('Unexpected model selection');
      requested.add(path);
      // Model parsing keeps its existing evidence. Only the calibration/pose
      // response bytes are needed for this media-routing pipeline check.
      return new File([path === manifest.files.cameras ? cameraBody : path === manifest.files.images ? poseBody : Buffer.alloc(0)], new URL(path).pathname.split('/').at(-1));
    } });
    if (Object.values(manifest.files).some(path => !requested.has(path))) throw new Error('Released manifest loader skipped a selected model file');
    const prompts = [];
    const context = await api.prepareNativeMedia(files, files.get('sparse/0/cameras.bin'), cameras, images, undefined,
      { selectPhotos: async candidates => { prompts.push(candidates); return candidates.find(candidate => candidate.path === 'photos:keep'); } });
    const launched = { context, prompts };
    const launchedPath = path => physical(api.imageResourceUrl(baseUrl, path));
    if (launched.prompts.length || launched.context.bindings.size !== original.context.bindings.size
        || launched.context.nativeMasks.size !== original.context.nativeMasks.size
        || [...original.context.bindings].some(([name, binding]) => {
          const current = launched.context.bindings.get(name);
          return !current || launchedPath(current.sourceImagePath) !== physical(binding.sourceImagePath)
            || Boolean(current.mask) !== Boolean(binding.mask)
            || current.mask && (launchedPath(current.mask.path) !== physical(binding.mask.path) || current.mask.role !== binding.mask.role);
        }) || [...original.context.nativeMasks].some(([name, mask]) => {
          const current = launched.context.nativeMasks.get(name);
          return !current || launchedPath(current.path) !== physical(mask.path) || current.role !== mask.role;
        })) {
      const differences = [...original.context.bindings].filter(([name, binding]) => {
        const current = launched.context.bindings.get(name);
        return !current || launchedPath(current.sourceImagePath) !== physical(binding.sourceImagePath)
          || Boolean(current.mask) !== Boolean(binding.mask)
          || current.mask && (launchedPath(current.mask.path) !== physical(binding.mask.path) || current.mask.role !== binding.mask.role);
      }).slice(0, 3).map(([name, binding]) => ({ name, before: binding, after: launched.context.bindings.get(name) }));
      throw Object.assign(new Error('Manifest changes known photo/mask bindings or requires selection'), { details: { prompts: launched.prompts, differences } });
    }
    const review = { ...Object.fromEntries(['sourceId', 'revision', 'kind', 'path', 'files', 'scope', 'sourceViewerUrl'].map(key => [key, row[key]])),
      sample: { ...row.sample, name: sample.name },
      photos, masks, nameToPath: names, mappingReceipts,
      nameCheck: { inspected: images.size, matched: original.context.bindings.size, registered, complete,
        ambiguous: original.context.diagnostics.filter(item => item.code === 'AMBIGUOUS_IMAGE_PATH').length },
      modelReceipts: Object.fromEntries(Object.entries(row.modelReceipts).map(([role, receipt]) => [role,
        Object.fromEntries(['path', 'bytes', 'sourceBytes', 'sha256', 'entire'].map(key => [key, receipt[key]]))])),
      checks: { inventoryComplete: true, sampleDimensionsMatch: true, sampleBinding: true, manifestBinding: true, noSelectionPrompt: true } };
    review.selectionSha256 = hash(JSON.stringify(canonical({ ...review, checkedAt, viewerVersion, viewerCommit })));
    scenes.push(review);
  } catch (error) {
    failures.push({ id: row.id, sourceId: row.sourceId, revision: row.revision, kind: row.kind, path: row.path, files: row.files,
      sourceViewerUrl: row.sourceViewerUrl, reason: String(error), ...(error.details ? { details: error.details } : {}) });
  }
}
await writeFile(values.output, JSON.stringify({ schemaVersion: 1, checkedAt, viewerCommit, viewerVersion, inputSha256: hash(inputBytes), scenes, failures }));
const reasons = {};
for (const row of failures) reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
console.log(JSON.stringify({ examined: input.scenes.length, passed: scenes.length, allNamesInspected: scenes.filter(row => row.nameCheck.complete).length, reasons }));
