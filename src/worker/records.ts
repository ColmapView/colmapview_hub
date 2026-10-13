import { MAX_REQUEST_BYTES } from '../shared/model';
import type { LinkMetadata, LinkRecord } from '../shared/model';
import { isObject, parseStoredRecord } from './validation';

export const WORDLIST_KEY = 'internal/wordlists-v1.json';
export const recordKey = (id: string) => `links/${id}.json`;

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
