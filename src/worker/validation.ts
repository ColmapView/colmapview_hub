import { LOOPBACK_HOSTS, MAX_PREVIEW_BYTES, MAX_REQUEST_BYTES, PREVIEW_HEIGHT, PREVIEW_WIDTH, SECRET_PATTERN, VIEWER_ORIGINS } from '../shared/model';
import type { AssetSummary, CreateLinkInput, LicenseInfo, LinkMetadata } from '../shared/model';

export class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseAssetSummary(value: unknown): AssetSummary {
  if (!isObject(value) || Object.keys(value).some(key => !['format', 'imageFormat', 'colmap', 'images', 'masks', 'splats', 'viewerSettings', 'preview'].includes(key))
    || (value.format !== 'folder' && value.format !== 'zip') || (value.imageFormat !== 'original' && value.imageFormat !== 'jpeg')
    || (value.format === 'folder' && value.imageFormat !== 'original') || typeof value.viewerSettings !== 'boolean' || typeof value.preview !== 'boolean'
    || !isObject(value.colmap) || Object.keys(value.colmap).some(key => !['files', 'cameras', 'points'].includes(key))) {
    throw new InputError('Asset summary is invalid.');
  }
  const count = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new InputError('Asset counts must be nonnegative whole numbers.');
    return value;
  };
  return { format: value.format, imageFormat: value.imageFormat,
    colmap: { files: count(value.colmap.files), cameras: count(value.colmap.cameras), points: count(value.colmap.points) },
    images: count(value.images), masks: count(value.masks), splats: count(value.splats), viewerSettings: value.viewerSettings, preview: value.preview };
}

const hasControls = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);

function text(value: unknown, name: string, max: number, optional = false): string {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string') throw new InputError(`${name} is required.`);
  const normalized = value.trim().replace(/\s+/g, ' ');
  if ((!optional && !normalized) || normalized.length > max || hasControls(normalized)) {
    throw new InputError(`${name} is invalid or too long.`);
  }
  return normalized;
}

/** Whether a URL parses and uses one of the given protocols, http(s) by default. */
export function isHttpUrl(value: string | URL, protocols: readonly string[] = ['http:', 'https:']): boolean {
  try { return protocols.includes(new URL(value).protocol); } catch { return false; }
}

/** An http(s) origin on this machine, accepted only when the Hub itself runs locally. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.origin === origin && isHttpUrl(url) && LOOPBACK_HOSTS.includes(url.hostname);
  } catch { return false; }
}

const CREDENTIAL_PARAMS = new Set(['accesstoken', 'refreshtoken', 'idtoken', 'secretaccesskey', 'awssecretaccesskey',
  'secretkey', 'accesskeyid', 'sessiontoken', 'clientsecret', 'apikey',
  'xamzsignature', 'xamzcredential', 'xamzsecuritytoken', 'xgoogsignature', 'xgoogcredential',
  'sig', 'signature', 'token', 'awsaccesskeyid']);

/** Query and fragment parameter names: a presigned link can carry credentials in either. */
function parameterNames(url: URL): string[] {
  return [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
}

function rejectCredentials(url: URL, message = 'Use a viewer link without access credentials.'): void {
  if (url.username || url.password || parameterNames(url).some(key => CREDENTIAL_PARAMS.has(key.toLowerCase().replace(/[-_]/g, '')))) {
    throw new InputError(message);
  }
}

function viewerUrl(value: unknown, allowLoopback: boolean): string {
  if (typeof value !== 'string' || value.length > 32768 || /\s/.test(value) || hasControls(value)) throw new InputError('Enter a valid ColmapView link.');
  let url: URL;
  try { url = new URL(value); } catch { throw new InputError('Enter a valid ColmapView link.'); }
  // Normalizing percent-encodes characters such as '€' (one becomes nine); bounding the stored form keeps records under MAX_RECORD_BYTES.
  if (url.href.length > 32768) throw new InputError('Enter a valid ColmapView link.');
  if (!(VIEWER_ORIGINS.includes(url.origin) || (allowLoopback && isLoopbackOrigin(url.origin))) || !/^\/(?:latest\/|dev\/|v\d+\.\d+\.\d+\/)?$/.test(url.pathname)) {
    throw new InputError('Use the OpsiClear or GitHub Pages ColmapView viewer.');
  }
  rejectCredentials(url);
  // Uploads publish an explicit source URL. Opaque d= fragments can hide a different source and credentials.
  if (new URLSearchParams(url.hash.slice(1)).has('d')) throw new InputError('Use a viewer link with its dataset in the URL query.');
  for (const source of url.searchParams.getAll('url')) {
    if (!source) continue;
    try { rejectCredentials(new URL(source, url)); } catch (error) { if (error instanceof InputError) throw error; }
  }
  return url.href;
}

function licenseInfo(value: unknown): LicenseInfo | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || Object.keys(value).some(key => !['id', 'name', 'url'].includes(key))) throw new InputError('License information is invalid.');
  const id = text(value.id, 'License ID', 80, true);
  const name = text(value.name, 'License name', 160, true);
  let url: string | undefined;
  if (value.url !== undefined && value.url !== '') {
    if (typeof value.url !== 'string' || value.url.length > 2048) throw new InputError('License link is invalid.');
    try {
      const parsed = new URL(value.url);
      if (!isHttpUrl(parsed, ['https:']) || parsed.username || parsed.password) throw new Error();
      rejectCredentials(parsed, 'Use a license link without access credentials.');
      url = parsed.href;
    } catch (error) { if (error instanceof InputError) throw error; throw new InputError('Use an HTTPS license link.'); }
    // The normalized link can be longer than the input, as in viewerUrl().
    if (url.length > 2048) throw new InputError('License link is invalid.');
  }
  return id || name || url ? { ...(id ? { id } : {}), ...(name ? { name } : {}), ...(url ? { url } : {}) } : undefined;
}

/** Bytes of a binary string, in one plain pass. */
function binaryBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function base64Bytes(value: string): Uint8Array {
  return binaryBytes(atob(value));
}

export function decodePreview(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new InputError('Preview must be a JPEG thumbnail under 64 KiB.');
  }
  const binary = atob(value);
  if (binary.length < 20 || binary.length > MAX_PREVIEW_BYTES || btoa(binary) !== value) throw new InputError('Preview is invalid.');
  const bytes = binaryBytes(binary);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new InputError('Preview must be a JPEG.');
  let offset = 2;
  let dimensionsFound = false;
  let scanFound = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) throw new InputError('Preview JPEG is invalid.');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw new InputError('Preview JPEG is invalid.');
    if (marker === 0xe1 || marker === 0xfe) throw new InputError('Re-encode the preview to remove image metadata.');
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 8 || bytes[offset + 2] !== 8) throw new InputError('Preview JPEG is invalid.');
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (!(width === PREVIEW_WIDTH && height === PREVIEW_HEIGHT) && !(width === 600 && height === 315)) {
        throw new InputError('Preview must be 320 × 168 pixels (or legacy 600 × 315).');
      }
      dimensionsFound = true;
    }
    if (marker === 0xda) { scanFound = offset + length < bytes.length - 2; break; }
    offset += length;
  }
  if (!dimensionsFound || !scanFound) throw new InputError('Preview JPEG is invalid.');
  return bytes;
}

export function parseMetadata(value: Record<string, unknown>, allowLoopback = false): LinkMetadata {
  const thumbnailBase64 = value.thumbnailBase64;
  if (typeof thumbnailBase64 !== 'string') throw new InputError('Preview is required.');
  decodePreview(thumbnailBase64);
  const license = licenseInfo(value.license);
  const assets = value.assets === undefined ? undefined : parseAssetSummary(value.assets);
  return {
    viewerUrl: viewerUrl(value.viewerUrl, allowLoopback),
    title: text(value.title, 'Title', 120),
    description: text(value.description, 'Description', 280, true),
    thumbnailBase64,
    ...(license ? { license } : {}),
    ...(assets ? { assets } : {}),
  };
}

const CREATE_KEYS = new Set(['viewerUrl', 'title', 'description', 'thumbnailBase64', 'license', 'assets', 'managementSecret', 'listed',
  'access', 'publicAcknowledged']);

export function parseCreateInput(value: unknown, allowLoopback = false): CreateLinkInput {
  if (!isObject(value) || Object.keys(value).some(key => !CREATE_KEYS.has(key))) throw new InputError('Invalid link request.');
  if (value.publicAcknowledged !== true) throw new InputError('Confirm that this link and preview will be accessible to anyone with the link.');
  if (typeof value.managementSecret !== 'string' || !SECRET_PATTERN.test(value.managementSecret)) throw new InputError('Management key is invalid.');
  if (value.access !== undefined && value.access !== 'public' && value.access !== 'private') throw new InputError('Access must be public or private.');
  if (value.listed !== undefined && typeof value.listed !== 'boolean') throw new InputError('Listing choice is invalid.');
  const access = value.access === 'private' ? 'private' : 'public';
  if (value.listed === true && access === 'private') throw new InputError('Private links cannot be listed.');
  return { ...parseMetadata(value, allowLoopback), managementSecret: value.managementSecret, listed: value.listed === true, access, publicAcknowledged: true };
}

export async function readBoundedJson(request: Request): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new InputError('Use JSON for link requests.', 415);
  if (request.headers.get('Content-Encoding')) throw new InputError('Encoded requests are not supported.', 415);
  if (Number(request.headers.get('Content-Length')) > MAX_REQUEST_BYTES) throw new InputError('Link request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('Link request is empty.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) { await reader.cancel(); throw new InputError('Link request is too large.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
  catch { throw new InputError('Link request is not valid JSON.'); }
}
