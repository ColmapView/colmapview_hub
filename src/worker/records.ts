import { ID_PATTERN, isListedId, MAX_REQUEST_BYTES } from '../shared/model';
import type { ListedLink, LinkMetadata, LinkRecord } from '../shared/model';
import { isObject, parseStoredRecord } from './validation';

export const WORDLIST_KEY = 'internal/wordlists-v1.json';
export const recordKey = (id: string) => `${isListedId(id) ? 'listed' : 'links'}/${id}.json`;

/** Listing and content are committed in the same R2 object; unlisted keys are never scanned. */
export async function listPublicRecords(bucket: R2Bucket, cursor?: string): Promise<{ links: ListedLink[]; cursor?: string }> {
  const page = await bucket.list({ prefix: 'listed/', limit: 12, include: ['customMetadata'], ...(cursor ? { cursor } : {}) });
  const links = page.objects.map(object => {
    const id = object.key.slice('listed/'.length, -'.json'.length);
    const title = object.customMetadata?.title;
    const createdAt = object.customMetadata?.createdAt;
    if (!ID_PATTERN.test(id) || !isListedId(id) || !title || title.length > 120 || !createdAt || !Number.isFinite(Date.parse(createdAt))) throw new Error('Invalid public listing');
    return { id, title, createdAt };
  });
  return { links, ...(page.truncated ? { cursor: page.cursor } : {}) };
}

export async function readRecord(bucket: R2Bucket, id: string): Promise<LinkRecord | null> {
  const object = await bucket.get(recordKey(id));
  if (!object) return null;
  if (object.size > MAX_REQUEST_BYTES) throw new Error('Stored record is too large');
  try { return parseStoredRecord(await object.json(), id); }
  catch (error) { throw new Error('Invalid stored record', { cause: error }); }
}

export async function readWordlists(bucket: R2Bucket): Promise<{ adjectives: string[]; nouns: string[] }> {
  const object = await bucket.get(WORDLIST_KEY);
  if (!object || object.size > MAX_REQUEST_BYTES) throw new Error('Private wordlists are unavailable');
  const value: unknown = await object.json();
  if (!isObject(value) || value.version !== 1) throw new Error('Invalid private wordlists');
  const list = (items: unknown): string[] => {
    if (!Array.isArray(items) || items.length < 1 || items.length > 8192 || items.some(word => typeof word !== 'string' || !/^[a-z]{3,14}$/.test(word)) || new Set(items).size !== items.length) {
      throw new Error('Invalid private wordlists');
    }
    return items;
  };
  return { adjectives: list(value.adjectives), nouns: list(value.nouns) };
}

export function metadataFingerprint(metadata: LinkMetadata): string {
  return JSON.stringify([metadata.viewerUrl, metadata.title, metadata.description, metadata.thumbnailBase64, metadata.license?.id ?? '', metadata.license?.name ?? '', metadata.license?.url ?? '']);
}
