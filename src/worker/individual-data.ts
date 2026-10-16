import { INDIVIDUAL_PAGE_SIZE, individualEntry, individualSummary, individualTokens, matchesIndividualDataset } from '../shared/individual-catalog';
import type { IndividualIndex, IndividualPage, IndividualRecord, IndividualSource } from '../shared/individual-catalog';
import type { CatalogEntry } from '../shared/catalog';
import { InputError } from './validation';

const ROOT = '/hub/datasets/individual/';
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
type Assets = Pick<Fetcher, 'fetch'>;

/** Only operator-built, fixed same-origin asset keys are read. Submitted data URLs
 * never enter this reader, and the private share-link bucket is not involved. */
export async function individualAsset<T>(assets: Assets, origin: string, path: string): Promise<T | null> {
  if (!/^(?:index\.json|(?:packs\/\d+|ids\/[a-f0-9]{2}|tokens\/[a-f0-9]{3}|facets\/[a-f0-9]{16}|sources\/[a-z0-9-]+-[a-f0-9]{12})\.json)$/.test(path)) throw new Error('Invalid built catalog key');
  const response = await assets.fetch(new Request(origin + ROOT + path));
  if (response.status === 404) return null;
  if (!response.ok || !response.body) throw new Error('Catalog metadata unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_ASSET_BYTES) throw new Error('Built catalog asset exceeds the reader bound');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export async function individualIndex(assets: Assets, origin: string): Promise<IndividualIndex> {
  const index = await individualAsset<IndividualIndex>(assets, origin, 'index.json');
  if (!index || index.schemaVersion !== 1 || !Number.isSafeInteger(index.total) || index.total < 1 || index.total > 10000000
    || index.packSize !== 2048 || !Array.isArray(index.sources) || index.sources.length > 10000) throw new Error('Invalid individual catalog index');
  return index;
}

/** Delta-varint posting lists keep large collections compact on disk and use
 * typed arrays during intersections, rather than millions of JS object records. */
export function decodePostings(encoded: string, total: number): Uint32Array {
  const bytes = atob(encoded);
  let count = 0;
  for (let index = 0; index < bytes.length; index++) if (bytes.charCodeAt(index) < 128) count++;
  const values = new Uint32Array(count);
  let ordinal = 0, delta = 0, shift = 0, position = 0;
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes.charCodeAt(index);
    delta += (byte & 127) * 2 ** shift;
    if (byte >= 128) { shift += 7; if (shift > 28) throw new Error('Invalid catalog posting'); continue; }
    ordinal += delta;
    if (ordinal >= total || (position > 0 && ordinal <= values[position - 1])) throw new Error('Invalid catalog posting order');
    values[position++] = ordinal;
    delta = 0; shift = 0;
  }
  if (shift) throw new Error('Truncated catalog posting');
  return values;
}

export function intersectPostings(left: Uint32Array, right: Uint32Array): Uint32Array {
  const result = new Uint32Array(Math.min(left.length, right.length));
  let a = 0, b = 0, count = 0;
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) { result[count++] = left[a++]; b++; }
    else if (left[a] < right[b]) a++;
    else b++;
  }
  return result.subarray(0, count);
}

export const INDIVIDUAL_FILTERS = ['q', 'dataset', 'provider', 'license', 'kind', 'status', 'delivery', 'viewer', 'page'] as const;
export function individualFilters(input: URLSearchParams): URLSearchParams {
  const filters = new URLSearchParams();
  for (const key of INDIVIDUAL_FILTERS) {
    const value = input.get(key)?.trim();
    if (!value) continue;
    if (value.length > (key === 'q' ? 160 : 256)) throw new InputError('Dataset search is too long.');
    filters.set(key, value);
  }
  if (individualTokens(filters.get('q') || '').length > 6) throw new InputError('Use up to six search words.');
  if (filters.has('page') && (!/^\d{1,7}$/.test(filters.get('page')!) || Number(filters.get('page')) < 1)) throw new InputError('Invalid dataset page.');
  return filters;
}

async function tokenShard(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].slice(0, 2).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 3);
}

export async function individualRecords(assets: Assets, origin: string, index: IndividualIndex, ordinals: number[]): Promise<IndividualRecord[]> {
  const numbers = [...new Set(ordinals.map(value => Math.floor(value / index.packSize)))];
  const packs = await Promise.all(numbers.map(async number => [number, await individualAsset<IndividualRecord[]>(assets, origin, `packs/${number}.json`)] as const));
  const byNumber = new Map(packs);
  return ordinals.map(ordinal => {
    const row = byNumber.get(Math.floor(ordinal / index.packSize))?.[ordinal % index.packSize];
    if (!row || !index.sources[row[1]]) throw new Error('Individual metadata record missing');
    return row;
  });
}

export async function searchIndividuals(assets: Assets, origin: string, index: IndividualIndex, filters: URLSearchParams): Promise<IndividualPage> {
  const terms = individualTokens(filters.get('q') || '');
  const shards = await Promise.all(terms.map(tokenShard));
  const uniqueShards = [...new Set(shards)];
  const maps = new Map(await Promise.all(uniqueShards.map(async shard => [shard,
    await individualAsset<Record<string, string>>(assets, origin, `tokens/${shard}.json`)] as const)));
  const postings: Uint32Array[] = terms.map((term, position) => {
    const mapping = maps.get(shards[position]);
    const encoded = mapping && Object.hasOwn(mapping, term) ? mapping[term] : undefined;
    return encoded === undefined ? new Uint32Array() : decodePostings(encoded, index.total);
  });
  for (const field of ['kind', 'status', 'delivery', 'viewer']) {
    const value = filters.get(field);
    if (!value) continue;
    const values = index.facets[field];
    const facet = values && Object.hasOwn(values, value) ? values[value] : undefined;
    if (!facet) return { entries: [], total: 0, page: 1, pages: 1, generation: index.generation };
    const encoded = await individualAsset<{ postings: string }>(assets, origin, `facets/${facet.file}.json`);
    if (!encoded) throw new Error('Catalog facet missing');
    postings.push(decodePostings(encoded.postings, index.total));
  }
  postings.sort((a, b) => a.length - b.length);
  let candidates = postings[0];
  for (let position = 1; position < postings.length && candidates.length; position++) candidates = intersectPostings(candidates, postings[position]);
  const sources = index.sources.filter(source => matchesIndividualDataset(source, filters.get('dataset') || '')
    && (!filters.get('provider') || source.provider === filters.get('provider')) && (!filters.get('license') || source.license === filters.get('license')) && source.count);
  const requested = Number(filters.get('page') || 1);
  let total = 0;
  const selected: number[] = [];
  const requestedStart = (requested - 1) * INDIVIDUAL_PAGE_SIZE;
  if (!candidates) {
    for (const source of sources) {
      const start = Math.max(0, requestedStart - total);
      const end = Math.min(source.count, requestedStart + INDIVIDUAL_PAGE_SIZE - total);
      for (let offset = start; offset < end; offset++) selected.push(source.start + offset);
      total += source.count;
    }
  } else {
    let sourcePosition = 0;
    for (const ordinal of candidates) {
      while (sourcePosition < sources.length && ordinal >= sources[sourcePosition].start + sources[sourcePosition].count) sourcePosition++;
      const source = sources[sourcePosition];
      if (!source) break;
      if (ordinal < source.start) continue;
      if (total >= requestedStart && selected.length < INDIVIDUAL_PAGE_SIZE) selected.push(ordinal);
      total++;
    }
  }
  const pages = Math.max(1, Math.ceil(total / INDIVIDUAL_PAGE_SIZE));
  if (requested > pages) throw new InputError('Dataset page does not exist.', 404);
  const rows = await individualRecords(assets, origin, index, selected);
  return { entries: rows.map(row => individualSummary(row, index.sources[row[1]])), total, page: requested, pages, generation: index.generation };
}

export async function readIndividual(assets: Assets, origin: string, index: IndividualIndex, id: string): Promise<CatalogEntry | null> {
  if (!/^data-[a-f0-9]{24}$/.test(id)) return null;
  const map = await individualAsset<Record<string, number>>(assets, origin, `ids/${id.slice(5, 7)}.json`);
  const ordinal = map?.[id];
  if (!Number.isSafeInteger(ordinal) || ordinal === undefined || ordinal < 0 || ordinal >= index.total) return null;
  const [row] = await individualRecords(assets, origin, index, [ordinal]);
  if (row[0] !== id) throw new Error('Individual identity mismatch');
  const source: IndividualSource = index.sources[row[1]];
  const parent = await individualAsset<CatalogEntry>(assets, origin, `sources/${source.id}.json`);
  if (!parent) throw new Error('Dataset source metadata missing');
  return individualEntry(row, source, parent);
}
