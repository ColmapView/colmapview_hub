import { ID_PATTERN, isListedId, MAX_RECORD_BYTES, MAX_WORDLIST_BYTES } from '../shared/model';
import type { AssetSummary, CardRecord, LicenseInfo, ListedLink, LinkMetadata, Ownership } from '../shared/model';
import type { Wordlists } from './crypto';
import { isHttpUrl, isObject, parseAssetSummary } from './validation';

export const WORDLIST_KEY = 'internal/wordlists-v1.json';
export const recordKey = (id: string) => `${isListedId(id) ? 'listed' : 'links'}/${id}.json`;

/** Listing and content are committed in the same R2 object; unlisted keys are never scanned. A bad entry is logged and skipped. */
export async function listPublicRecords(bucket: R2Bucket, cursor?: string): Promise<{ links: ListedLink[]; cursor?: string }> {
  const page = await bucket.list({ prefix: 'listed/', limit: 12, include: ['customMetadata'], ...(cursor ? { cursor } : {}) });
  const links = page.objects.flatMap(object => {
    try { return [listedLink(object)]; }
    catch (error) { console.warn('Skipping an invalid listing', object.key, error); return []; }
  });
  return { links, ...(page.truncated ? { cursor: page.cursor } : {}) };
}

function listedLink(object: R2Object): ListedLink {
  const id = object.key.slice('listed/'.length, -'.json'.length);
  const title = object.customMetadata?.title;
  const createdAt = object.customMetadata?.createdAt;
  if (!ID_PATTERN.test(id) || !isListedId(id) || !title || title.length > 120 || !createdAt || !Number.isFinite(Date.parse(createdAt))) {
    throw new Error('Invalid public listing');
  }
  const assets = object.customMetadata?.assets;
  return { id, title, createdAt, ...(assets ? { assets: parseAssetSummary(JSON.parse(assets)) } : {}) };
}

async function readStoredJson(bucket: R2Bucket, id: string): Promise<unknown> {
  const object = await bucket.get(recordKey(id));
  if (!object) return undefined;
  if (object.size > MAX_RECORD_BYTES) throw new Error('Stored record is too large');
  try { return await object.json(); }
  catch (error) { throw new Error('Invalid stored record', { cause: error }); }
}

function storedLicense(value: unknown): LicenseInfo | undefined {
  if (!isObject(value)) return undefined;
  const license: LicenseInfo = {
    ...(typeof value.id === 'string' && value.id ? { id: value.id } : {}),
    ...(typeof value.name === 'string' && value.name ? { name: value.name } : {}),
    ...(typeof value.url === 'string' && isHttpUrl(value.url, ['https:']) ? { url: value.url } : {}),
  };
  return Object.keys(license).length ? license : undefined;
}

function storedAssets(value: unknown): AssetSummary | undefined {
  try { return value === undefined ? undefined : parseAssetSummary(value); } catch { return undefined; }
}

/** What a page needs. Unknown keys and creation-only rules are ignored, so records written by older or newer Hubs keep rendering. */
export function toCardRecord(value: unknown, id: string): CardRecord {
  if (!isObject(value) || typeof value.title !== 'string' || !value.title.trim() || typeof value.viewerUrl !== 'string'
    || !isHttpUrl(value.viewerUrl) || typeof value.thumbnailBase64 !== 'string' || !value.thumbnailBase64) throw new Error('Invalid stored record');
  const license = storedLicense(value.license);
  const assets = storedAssets(value.assets);
  return { id, title: value.title, description: typeof value.description === 'string' ? value.description : '',
    viewerUrl: value.viewerUrl, thumbnailBase64: value.thumbnailBase64,
    ...(license ? { license } : {}), ...(assets ? { assets } : {}),
    access: value.access === 'private' ? 'private' : 'public' };
}

export async function readCard(bucket: R2Bucket, id: string): Promise<CardRecord | null> {
  const value = await readStoredJson(bucket, id);
  return value === undefined ? null : toCardRecord(value, id);
}

/** Deletion and the creation candidate check compare only these hashes. */
export async function readOwnership(bucket: R2Bucket, id: string): Promise<Ownership | null> {
  const value = await readStoredJson(bucket, id);
  if (value === undefined) return null;
  const record = isObject(value) ? value : {};
  return { ownerHash: typeof record.ownerHash === 'string' ? record.ownerHash : '',
    fingerprint: typeof record.fingerprint === 'string' ? record.fingerprint : '' };
}

let wordlists: Wordlists | null = null;

/** Version-1 lists never change, so each isolate keeps them once read. Requests never share a pending read, and a failed read is retried by the next request. */
export async function readWordlists(bucket: R2Bucket): Promise<Wordlists> {
  return wordlists ??= await loadWordlists(bucket);
}

/** Tests replace the lists between cases. */
export function resetWordlistCache(): void {
  wordlists = null;
}

async function loadWordlists(bucket: R2Bucket): Promise<Wordlists> {
  const object = await bucket.get(WORDLIST_KEY);
  if (!object || object.size > MAX_WORDLIST_BYTES) throw new Error('Private wordlists are unavailable');
  const value: unknown = await object.json();
  if (!isObject(value) || value.version !== 1) throw new Error('Invalid private wordlists');
  const list = (items: unknown): string[] => {
    if (!Array.isArray(items) || items.length < 1 || items.length > 8192 || items.some(word => typeof word !== 'string' || !/^[a-z]{3,14}$/.test(word))
      || new Set(items).size !== items.length) throw new Error('Invalid private wordlists');
    return items;
  };
  return { adjectives: list(value.adjectives), nouns: list(value.nouns) };
}

export function metadataFingerprint(metadata: LinkMetadata): string {
  return JSON.stringify([metadata.viewerUrl, metadata.title, metadata.description, metadata.thumbnailBase64, metadata.license?.id ?? '',
    metadata.license?.name ?? '', metadata.license?.url ?? '', ...(metadata.assets ? [metadata.assets] : [])]);
}
