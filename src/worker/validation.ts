import { MAX_PREVIEW_BYTES, MAX_REQUEST_BYTES, PREVIEW_HEIGHT, PREVIEW_WIDTH, ID_PATTERN, isListedId } from '../shared/model';
import type { AssetSummary, CreateLinkInput, LicenseInfo, LinkMetadata, LinkRecord } from '../shared/model';

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

const VIEWER_ORIGINS = new Set(['https://colmapview.opsiclear.com', 'https://colmapview.github.io']);
const CREDENTIAL_PARAMS = new Set(['access_token', 'refresh_token', 'secret_access_key', 'aws_secret_access_key', 'secretkey']);

function rejectCredentials(url: URL): void {
  if (url.username || url.password || [...url.searchParams.keys()].some(key => CREDENTIAL_PARAMS.has(key.toLowerCase()))) {
    throw new InputError('Use a viewer link without access credentials.');
  }
}

function viewerUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32768 || /\s/.test(value) || hasControls(value)) throw new InputError('Enter a valid ColmapView link.');
  let url: URL;
  try { url = new URL(value); } catch { throw new InputError('Enter a valid ColmapView link.'); }
  if (!VIEWER_ORIGINS.has(url.origin) || !/^\/(?:latest\/|dev\/|v\d+\.\d+\.\d+\/)?$/.test(url.pathname)) {
    throw new InputError('Use the OpsiClear or GitHub Pages ColmapView viewer.');
  }
  rejectCredentials(url);
  const source = url.searchParams.get('url');
  if (source) {
    try { rejectCredentials(new URL(source)); } catch (error) { if (error instanceof InputError) throw error; }
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
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
      url = parsed.href;
    } catch { throw new InputError('Use an HTTPS license link.'); }
  }
  return id || name || url ? { ...(id ? { id } : {}), ...(name ? { name } : {}), ...(url ? { url } : {}) } : undefined;
}

export function decodePreview(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new InputError('Preview must be a JPEG thumbnail under 64 KiB.');
  }
  const binary = atob(value);
  if (binary.length < 20 || binary.length > MAX_PREVIEW_BYTES || btoa(binary) !== value) throw new InputError('Preview is invalid.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
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
      if (width !== PREVIEW_WIDTH || height !== PREVIEW_HEIGHT) throw new InputError('Preview must be 600 × 315 pixels.');
      dimensionsFound = true;
    }
    if (marker === 0xda) { scanFound = offset + length < bytes.length - 2; break; }
    offset += length;
  }
  if (!dimensionsFound || !scanFound) throw new InputError('Preview JPEG is invalid.');
  return bytes;
}

export function parseMetadata(value: Record<string, unknown>): LinkMetadata {
  const thumbnailBase64 = value.thumbnailBase64;
  if (typeof thumbnailBase64 !== 'string') throw new InputError('Preview is required.');
  decodePreview(thumbnailBase64);
  const license = licenseInfo(value.license);
  const assets = value.assets === undefined ? undefined : parseAssetSummary(value.assets);
  return {
    viewerUrl: viewerUrl(value.viewerUrl),
    title: text(value.title, 'Title', 120),
    description: text(value.description, 'Description', 280, true),
    thumbnailBase64,
    ...(license ? { license } : {}),
    ...(assets ? { assets } : {}),
  };
}

export function parseCreateInput(value: unknown): CreateLinkInput {
  if (!isObject(value) || Object.keys(value).some(key => !['viewerUrl', 'title', 'description', 'thumbnailBase64', 'license', 'assets', 'managementSecret', 'listed', 'publicAcknowledged'].includes(key))) {
    throw new InputError('Invalid link request.');
  }
  if (value.publicAcknowledged !== true) throw new InputError('Confirm that this link and preview will be accessible to anyone with the link.');
  if (typeof value.managementSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.managementSecret)) throw new InputError('Management key is invalid.');
  if (value.listed !== undefined && typeof value.listed !== 'boolean') throw new InputError('Listing choice is invalid.');
  return { ...parseMetadata(value), managementSecret: value.managementSecret, listed: value.listed === true, publicAcknowledged: true };
}

export function parseStoredRecord(value: unknown, id: string): LinkRecord {
  if (!isObject(value) || value.schemaVersion !== 1 || value.id !== id || !ID_PATTERN.test(id)
    || typeof value.ownerHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.ownerHash)
    || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid stored record');
  const listed = value.listed === true;
  if (listed !== isListedId(id)) throw new Error('Stored visibility does not match its namespace');
  return { ...parseMetadata(value), schemaVersion: 1, id, ownerHash: value.ownerHash, fingerprint: value.fingerprint, createdAt: value.createdAt, listed };
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
