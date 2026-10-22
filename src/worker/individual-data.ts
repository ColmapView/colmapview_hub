import { INDIVIDUAL_PAGE_SIZE, canOpenIndividual, individualEntry, individualSummary, individualTokens, matchesIndividualDataset } from '../shared/individual-catalog';
import type { IndividualIndex, IndividualPage, IndividualRecord, IndividualSource } from '../shared/individual-catalog';
import type { CatalogEntry } from '../shared/catalog';
import { licenseCategory } from '../shared/license-categories';
import { InputError } from './validation';
import { FEED_MODES, defaultFeedSeed, discoveryOrder, feedMode, isDiscoveryAsset } from '../shared/discovery';

const ROOT = '/hub/datasets/individual/';
const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const MAX_PARALLEL_PACK_READS = 4;
type Assets = Pick<Fetcher, 'fetch'>;

/** Only operator-built, fixed same-origin asset keys are read. Submitted data URLs
 * never enter this reader, and the private share-link bucket is not involved. */
export async function individualAsset<T>(assets: Assets, origin: string, path: string): Promise<T | null> {
  if (!/^(?:(?:index|feed)\.json|(?:packs\/\d+|(?:ids|variants)\/[a-f0-9]{2}|tokens\/[a-f0-9]{3}|facets\/[a-f0-9]{16}|sources\/[a-z0-9-]+-[a-f0-9]{12})\.json)$/.test(path)) throw new Error('Invalid built catalog key');
  const response = await assets.fetch(new Request(origin + ROOT + path));
  if (response.status === 404) return null;
  if (!response.ok || !response.body) throw new Error('Catalog metadata unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_ASSET_BYTES) throw new Error('Built catalog asset exceeds the reader bound');
      parts.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
  parts.push(decoder.decode());
  return JSON.parse(parts.join('')) as T;
}

export async function individualIndex(assets: Assets, origin: string): Promise<IndividualIndex> {
  const index = await individualAsset<IndividualIndex>(assets, origin, 'index.json');
  if (!index || index.schemaVersion !== 1 || !Number.isSafeInteger(index.total) || index.total < 1 || index.total > 10000000
    || !Number.isSafeInteger(index.packSize) || index.packSize < 1 || index.packSize > 2048
    || index.groupedVariants !== undefined && (!Number.isSafeInteger(index.groupedVariants) || index.groupedVariants < 0 || index.groupedVariants > 10000000)
    || !Array.isArray(index.sources) || index.sources.length > 10000
    || index.discovery && (index.discovery.schemaVersion !== 1 || index.discovery.file !== 'feed.json')) throw new Error('Invalid individual catalog index');
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

export const INDIVIDUAL_FILTERS = ['q', 'dataset', 'provider', 'license', 'licenseCategory', 'kind', 'status', 'delivery', 'viewer', 'photos', 'data', 'sort', 'seed', 'page'] as const;
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
  if (filters.has('sort') && !FEED_MODES.some(mode => mode === filters.get('sort'))) throw new InputError('Invalid dataset feed.');
  if (filters.has('seed') && !/^[a-f0-9]{8,32}$/.test(filters.get('seed')!)) throw new InputError('Invalid feed seed.');
  return filters;
}

async function tokenShard(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].slice(0, 2).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 3);
}

export async function individualRecords(assets: Assets, origin: string, index: IndividualIndex, ordinals: number[]): Promise<IndividualRecord[]> {
  const groups = new Map<number, Set<number>>();
  for (const ordinal of ordinals) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= index.total) throw new Error('Invalid individual metadata ordinal');
    const number = Math.floor(ordinal / index.packSize);
    const group = groups.get(number) || new Set<number>();
    group.add(ordinal);
    groups.set(number, group);
  }
  const numbers = [...groups.keys()], selected = new Map<number, IndividualRecord>();
  // A shuffled page can touch 24 different packs. Bound simultaneous response
  // buffers and retain only requested rows, rather than every neighboring row.
  for (let start = 0; start < numbers.length; start += MAX_PARALLEL_PACK_READS) {
    const batch = await Promise.allSettled(numbers.slice(start, start + MAX_PARALLEL_PACK_READS).map(async number => {
      const rows = await individualAsset<IndividualRecord[]>(assets, origin, `packs/${number}.json`);
      for (const ordinal of groups.get(number)!) {
        const row = rows?.[ordinal % index.packSize];
        if (!row || !index.sources[row[1]]) throw new Error('Individual metadata record missing');
        selected.set(ordinal, row);
      }
    }));
    for (const result of batch) if (result.status === 'rejected') throw result.reason;
  }
  return ordinals.map(ordinal => selected.get(ordinal)!);
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
  const feed = index.discovery ? { mode: feedMode(filters.get('sort')), seed: filters.get('seed') || defaultFeedSeed() } : undefined;
  for (const field of ['kind', 'status', 'delivery', 'viewer', 'photos', 'data']) {
    const value = filters.get(field);
    if (!value) continue;
    const values = index.facets[field];
    const facet = values && Object.hasOwn(values, value) ? values[value] : undefined;
    if (!facet) return { entries: [], total: 0, page: 1, pages: 1, generation: index.generation, ...(feed ? { feed } : {}) };
    const encoded = await individualAsset<{ postings: string }>(assets, origin, `facets/${facet.file}.json`);
    if (!encoded) throw new Error('Catalog facet missing');
    postings.push(decodePostings(encoded.postings, index.total));
  }
  postings.sort((a, b) => a.length - b.length);
  let candidates = postings[0];
  for (let position = 1; position < postings.length && candidates.length; position++) candidates = intersectPostings(candidates, postings[position]);
  const sources = index.sources.filter(source => matchesIndividualDataset(source, filters.get('dataset') || '')
    && (!filters.get('provider') || source.provider === filters.get('provider')) && (!filters.get('license') || source.license === filters.get('license'))
    && (!filters.get('licenseCategory') || licenseCategory(source) === filters.get('licenseCategory')) && source.count);
  const requested = Number(filters.get('page') || 1);
  let total = 0;
  let selected: number[] = [];
  const matched: number[] = [];
  const requestedStart = (requested - 1) * INDIVIDUAL_PAGE_SIZE;
  if (!candidates) {
    for (const source of sources) {
      if (feed) for (let offset = 0; offset < source.count; offset++) matched.push(source.start + offset);
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
      if (feed) matched.push(ordinal);
      if (total >= requestedStart && selected.length < INDIVIDUAL_PAGE_SIZE) selected.push(ordinal);
      total++;
    }
  }
  const pages = Math.max(1, Math.ceil(total / INDIVIDUAL_PAGE_SIZE));
  if (requested > pages) throw new InputError('Dataset page does not exist.', 404);
  if (feed && total) {
    const asset = await individualAsset<unknown>(assets, origin, 'feed.json');
    if (!isDiscoveryAsset(asset, index)) throw new Error('Discovery metadata does not match the current catalog');
    selected = discoveryOrder(asset, sources, matched, feed, requestedStart + INDIVIDUAL_PAGE_SIZE).slice(requestedStart);
  }
  const rows = await individualRecords(assets, origin, index, selected);
  if (feed && rows.some(row => !canOpenIndividual(row, index.sources[row[1]]))) throw new Error('Discovery scene no longer qualifies for loading');
  return { entries: rows.map(row => individualSummary(row, index.sources[row[1]])), total, page: requested, pages, generation: index.generation, ...(feed ? { feed } : {}) };
}

export async function readIndividual(assets: Assets, origin: string, index: IndividualIndex, id: string): Promise<CatalogEntry | null> {
  if (!/^data-[a-f0-9]{24}$/.test(id)) return null;
  const map = await individualAsset<Record<string, number>>(assets, origin, `ids/${id.slice(5, 7)}.json`);
  const ordinal = map?.[id];
  let row: IndividualRecord | undefined;
  if (Number.isSafeInteger(ordinal) && ordinal !== undefined && ordinal >= 0 && ordinal < index.total) {
    [row] = await individualRecords(assets, origin, index, [ordinal]);
  } else if (index.groupedVariants) {
    // Historical variant links retain the exact original selection and proof,
    // without inflating browse totals, facets, feeds or collection counts.
    const variants = await individualAsset<Record<string, IndividualRecord>>(assets, origin, `variants/${id.slice(5, 7)}.json`);
    row = variants?.[id];
  }
  if (!row) return null;
  if (row[0] !== id) throw new Error('Individual identity mismatch');
  const source: IndividualSource = index.sources[row[1]];
  if (!source) throw new Error('Individual source metadata missing');
  const parent = await individualAsset<CatalogEntry>(assets, origin, `sources/${source.id}.json`);
  if (!parent) throw new Error('Dataset source metadata missing');
  return individualEntry(row, source, parent);
}
