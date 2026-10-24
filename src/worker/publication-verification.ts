import { publicationSource, type SourceVerification } from '../shared/publication';
import { InputError, isObject } from './validation';

const JSON_LIMIT = 256 * 1024;
const unavailable = () => new InputError('The source could not be checked. Try again later.', 503);

/** Stop at a fixed byte budget, including when a server ignores Range or Content-Length. */
export async function boundedBytes(response: Response, limit: number, prefix = false): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length <= limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!prefix && length + value.length > limit) throw new InputError('This source needs review before listing.', 422);
      const part = value.subarray(0, limit - length);
      chunks.push(part); length += part.length;
      if (prefix && length === limit) break;
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

const trustedHfHost = (host: string) => host === 'huggingface.co' || host.endsWith('.hf.co');

/** Only fixed provider origins receive verification traffic; redirects are checked individually. No cookies or authorization. */
async function providerRead(value: string, signal: AbortSignal, prefix = false): Promise<Response> {
  let url = new URL(value);
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !trustedHfHost(url.hostname)) throw unavailable();
    const response = await fetch(url, { redirect: 'manual', signal,
      headers: prefix ? { Range: 'bytes=0-255', Accept: 'application/octet-stream' } : { Accept: 'application/json' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('Location');
      if (!location) throw unavailable();
      url = new URL(location, url);
      continue;
    }
    if ([401, 403, 404].includes(response.status)) {
      await response.body?.cancel();
      throw new InputError('The dataset must be publicly readable without signing in.', 422);
    }
    if (!response.ok) { await response.body?.cancel(); throw unavailable(); }
    return response;
  }
  throw unavailable();
}

export interface VerificationResult { viewerUrl: string; verification?: SourceVerification; reviewReason?: string }

/** Verify bounded public metadata and first COLMAP records, never a submitted arbitrary host or a complete dataset. */
export async function verifyPublicationSource(viewerUrl: string, env: Env, origin: string): Promise<VerificationResult> {
  let source: URL;
  try { source = publicationSource(viewerUrl); } catch (error) { throw new InputError((error as Error).message); }
  const checkedAt = new Date().toISOString();
  const pending = (reviewReason: string): VerificationResult => ({ viewerUrl, reviewReason });
  if (source.origin === origin && /^\/hub\/datasets\/individual\/manifests\/[a-f0-9]{64}\.manifest\.json$/.test(source.pathname)
    && !source.search && !source.hash) {
    const response = await env.CATALOG_ASSETS.fetch(new Request(source));
    if (!response.ok) { await response.body?.cancel(); throw new InputError('This catalog manifest is unavailable.', 422); }
    const manifest: unknown = JSON.parse(new TextDecoder().decode(await boundedBytes(response, JSON_LIMIT)));
    if (!isObject(manifest) || ![1, 2, 3, 4, 5].includes(Number(manifest.version))) throw new InputError('This catalog manifest is invalid.', 422);
    return { viewerUrl, verification: { method: 'catalog_manifest', checkedAt } };
  }
  const match = source.origin === 'https://huggingface.co' && /^\/datasets\/([A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/(?:resolve|tree|blob)\/([^/]+)(?:\/(.*))?)?\/?$/.exec(source.pathname);
  if (!match) return pending('Public access and supported dataset files need an operator review.');
  const [, repo, revision, path = ''] = match;
  let requestedPath: string;
  try { requestedPath = decodeURIComponent(path); }
  catch { throw new InputError('The Hugging Face dataset path is invalid.'); }
  const signal = AbortSignal.timeout(15000);
  try {
    const api = `https://huggingface.co/api/datasets/${repo}${revision ? `/revision/${revision}` : ''}`;
    const response = await providerRead(api, signal);
    const info: unknown = JSON.parse(new TextDecoder().decode(await boundedBytes(response, JSON_LIMIT)));
    if (!isObject(info) || info.private !== false || info.gated !== false || typeof info.sha !== 'string' || !/^[a-f0-9]{40}$/.test(info.sha)) {
      throw new InputError('The dataset must be public and ungated.', 422);
    }
    if (!Array.isArray(info.siblings)) return pending('The repository file inventory needs review.');
    const files = new Set(info.siblings.flatMap(item => isObject(item) && typeof item.rfilename === 'string' ? [item.rfilename] : []));
    const selectedFile = files.has(requestedPath);
    const nativeFile = /(?:^|\/)(?:cameras|images|points3D)\.bin$/.test(requestedPath);
    if (nativeFile && !selectedFile) throw new InputError('The selected COLMAP file is missing from this public repository.', 422);
    if (selectedFile && !nativeFile) return pending('This file format needs an operator review.');
    const requestedDirectory = selectedFile ? requestedPath.slice(0, requestedPath.lastIndexOf('/') + 1)
      : requestedPath && !requestedPath.endsWith('/') ? `${requestedPath}/` : requestedPath;
    const cameras = [...files].filter(file => file.startsWith(requestedDirectory) && /(?:^|\/)cameras\.bin$/.test(file)
      && !file.split('/').some(segment => !segment || segment === '.' || segment === '..'));
    const pairs = cameras.filter(file => files.has(file.replace(/cameras\.bin$/, 'images.bin')));
    const cameraPath = selectedFile ? pairs.find(file => file === `${requestedDirectory}cameras.bin`)
      : pairs.length === 1 ? pairs[0] : undefined;
    if (!cameraPath) return pending('The exact camera and image model selection needs review.');
    const fileUrl = (file: string) => `https://huggingface.co/datasets/${repo}/resolve/${info.sha}/${file.split('/').map(encodeURIComponent).join('/')}`;
    const [cameraBytes, imageBytes] = await Promise.all([cameraPath, cameraPath.replace(/cameras\.bin$/, 'images.bin')].map(async file =>
      boundedBytes(await providerRead(fileUrl(file), signal, true), 256, true)));
    if (cameraBytes.length < 56 || imageBytes.length < 82) return pending('Model records are incomplete; a full format review is needed.');
    const camera = new DataView(cameraBytes.buffer, cameraBytes.byteOffset, cameraBytes.byteLength);
    const image = new DataView(imageBytes.buffer, imageBytes.byteOffset, imageBytes.byteLength);
    const count = Number(camera.getBigUint64(0, true));
    const registeredImages = Number(image.getBigUint64(0, true));
    const model = camera.getInt32(12, true);
    const width = camera.getBigUint64(16, true), height = camera.getBigUint64(24, true);
    const pose = Array.from({ length: 7 }, (_, index) => image.getFloat64(12 + 8 * index, true));
    const quaternionNorm = pose.slice(0, 4).reduce((total, value) => total + value * value, 0);
    const imageNameEnd = imageBytes.indexOf(0, 72);
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(registeredImages) || registeredImages < 1
      || model < 0 || model > 17 || width < 1n || height < 1n || width > 1_000_000n || height > 1_000_000n
      || !Number.isFinite(camera.getFloat64(32, true)) || camera.getFloat64(32, true) <= 0
      || !pose.every(Number.isFinite) || Math.abs(quaternionNorm - 1) > 0.01 || imageNameEnd <= 72) {
      return pending('Model headers need a full format review.');
    }
    // Keep the source shape and folder selection, but pin mutable repository references to the checked revision.
    const pinned = new URL(viewerUrl);
    const pinnedPath = (selectedFile ? requestedPath : requestedDirectory).split('/').map(encodeURIComponent).join('/');
    pinned.searchParams.set('url', `https://huggingface.co/datasets/${repo}/resolve/${info.sha}/${pinnedPath}`);
    return { viewerUrl: pinned.href, verification: { method: 'hf_colmap_headers', checkedAt, revision: info.sha, cameras: count, registeredImages } };
  } catch (error) {
    if (error instanceof InputError) {
      if (error.status === 422 && error.message.includes('needs review')) return pending(error.message);
      throw error;
    }
    throw unavailable();
  }
}
