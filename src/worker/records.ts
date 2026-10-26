import { isListedId, MAX_RECORD_BYTES, MAX_WORDLIST_BYTES } from '../shared/model';
import type { AssetSummary, CardRecord, LicenseInfo, LinkMetadata, Ownership } from '../shared/model';
import type { Wordlists } from './crypto';
import { isHttpUrl, isObject, parseAssetSummary } from './validation';
import { CATALOG_SHARE_NAME } from '../shared/dataset-share';
import { hubStorage, WORDLIST_KEY } from './storage';

/** Operator-reserved public names share the upload namespace without taking upload ownership. */
export interface CatalogAliasRecord { schemaVersion: 1; kind: 'catalog'; id: string; datasetId: string; createdAt: string }

export { WORDLIST_KEY } from './storage';
export const recordKey = (id: string) => `${isListedId(id) ? 'listed' : 'links'}/${id}.json`;

async function readStoredJson(database: D1Database, id: string): Promise<unknown> {
  const object = await hubStorage.get(database, recordKey(id));
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
export function toPublicMetadata(value: unknown, id: string): Omit<CardRecord, 'thumbnailBase64'> {
  if (!isObject(value) || typeof value.title !== 'string' || !value.title.trim() || typeof value.viewerUrl !== 'string'
    || !isHttpUrl(value.viewerUrl)) throw new Error('Invalid stored record');
  const license = storedLicense(value.license);
  const assets = storedAssets(value.assets);
  return { id, title: value.title, description: typeof value.description === 'string' ? value.description : '',
    viewerUrl: value.viewerUrl,
    ...(license ? { license } : {}), ...(assets ? { assets } : {}),
    access: value.access === 'private' ? 'private' : 'public' };
}

export function toCardRecord(value: unknown, id: string): CardRecord {
  if (!isObject(value) || typeof value.thumbnailBase64 !== 'string' || !value.thumbnailBase64) throw new Error('Invalid stored record');
  return { ...toPublicMetadata(value, id), thumbnailBase64: value.thumbnailBase64 };
}

export async function readShareRecord(database: D1Database, id: string): Promise<CardRecord | CatalogAliasRecord | null> {
  const value = await readStoredJson(database, id);
  if (isObject(value) && value.kind === 'catalog') {
    if (value.schemaVersion !== 1 || value.id !== id || !CATALOG_SHARE_NAME.test(id)
      || typeof value.datasetId !== 'string' || !/^data-[a-f0-9]{24}$/.test(value.datasetId)
      || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid catalog alias');
    return { schemaVersion: 1, kind: 'catalog', id, datasetId: value.datasetId, createdAt: value.createdAt };
  }
  return value === undefined ? null : toCardRecord(value, id);
}

/** Deletion and the creation candidate check compare only these hashes. */
export async function readOwnership(database: D1Database, id: string): Promise<Ownership | null> {
  const value = await readStoredJson(database, id);
  if (value === undefined) return null;
  const record = isObject(value) ? value : {};
  return { ownerHash: typeof record.ownerHash === 'string' ? record.ownerHash : '',
    fingerprint: typeof record.fingerprint === 'string' ? record.fingerprint : '' };
}

let wordlists: Wordlists | null = null;

/** Version-1 lists never change, so each isolate keeps them once read. Requests never share a pending read, and a failed read is retried by the next request. */
export async function readWordlists(database: D1Database): Promise<Wordlists> {
  return wordlists ??= await loadWordlists(database);
}

/** Tests replace the lists between cases. */
export function resetWordlistCache(): void {
  wordlists = null;
}

async function loadWordlists(database: D1Database): Promise<Wordlists> {
  const object = await hubStorage.get(database, WORDLIST_KEY);
  if (!object || object.size > MAX_WORDLIST_BYTES) throw new Error('Private wordlists are unavailable');
  const value: unknown = await object.json();
  return parseWordlists(value);
}

/** Shared with the authenticated operator; never publish the naming configuration. */
export function parseWordlists(value: unknown): Wordlists {
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
