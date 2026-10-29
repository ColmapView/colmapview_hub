import { expect, it, vi } from 'vitest';
import { individualAsset, individualRecords, individualFilters, searchIndividuals } from '../src/worker/individual-data';
import type { IndividualIndex, IndividualRecord } from '../src/shared/individual-catalog';

const origin = 'https://colmapview.opsiclear.com';
const fixtureIndex = (total = 22, packSize = 2): IndividualIndex => ({ schemaVersion: 1, generation: 'pack-test', total, packSize, checkedAt: '2026-10-22',
  sources: [{ id: 'hf-pack-fixture-0123456789ab', sourceId: 'hf:owner/pack', title: 'Pack', label: 'Pack', provider: 'huggingface',
    license: 'cc0', access: 'public', start: 0, count: total, listingComplete: true }],
  facets: {}, kinds: {}, levels: {}, delivery: {}, incompleteCollections: 0, scope: 'Reader fixture' });
const record = (ordinal: number): IndividualRecord => [`data-${ordinal.toString(16).padStart(24, '0')}`, 0,
  'cameras', `scene-${ordinal}`, 'COLMAP', null, null, null];

it('decodes split UTF-8 metadata and releases its body reader', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ label: 'Scene Ω 🎥' }));
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const assets = { fetch: async () => new Response(body) };
  expect(await individualAsset(assets, origin, 'index.json')).toEqual({ label: 'Scene Ω 🎥' });
  expect(body.locked).toBe(false);
});

it('cancels oversized metadata and releases the owned stream before parsing', async () => {
  let cancelled = false;
  const chunk = new Uint8Array(3 * 1024 * 1024).fill(32);
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(chunk); controller.enqueue(chunk); },
    cancel() { cancelled = true; },
  });
  await expect(individualAsset({ fetch: async () => new Response(body) }, origin, 'index.json'))
    .rejects.toThrow('Built catalog asset exceeds the reader bound');
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});

it('bounds shuffled pack reads while preserving requested order and repeated ordinals', async () => {
  const index = fixtureIndex();
  let active = 0, maximum = 0;
  const assets = { fetch: vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const pack = Number(/packs\/(\d+)\.json$/.exec(path)?.[1]);
    active++; maximum = Math.max(maximum, active);
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify([record(pack * 2), record(pack * 2 + 1)])));
        controller.close(); active--;
      }, 0);
    } }));
  }) };
  const ordinals = [15, 0, 18, 15, 2, 4, 6, 8, 10, 12];
  expect((await individualRecords(assets, origin, index, ordinals)).map(row => row[0]))
    .toEqual(ordinals.map(ordinal => record(ordinal)[0]));
  expect(maximum).toBeLessThanOrEqual(4);
  expect(active).toBe(0);
  expect(assets.fetch).toHaveBeenCalledTimes(9);
  assets.fetch.mockClear();
  expect(await individualRecords(assets, origin, index, [])).toEqual([]);
  for (const ordinal of [-1, 22, NaN]) await expect(individualRecords(assets, origin, index, [ordinal]))
    .rejects.toThrow('Invalid individual metadata ordinal');
  expect(assets.fetch).not.toHaveBeenCalled();
});

it('finishes the owned read batch on failure without scheduling later packs', async () => {
  let finished = 0;
  const assets = { fetch: vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const pack = Number(/packs\/(\d+)\.json$/.exec(path)?.[1]);
    if (pack === 0) return new Response(null, { status: 404 });
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      setTimeout(() => {
        controller.enqueue(new TextEncoder().encode(JSON.stringify([record(pack)])));
        controller.close(); finished++;
      }, 0);
    } }));
  }) };
  await expect(individualRecords(assets, origin, fixtureIndex(5, 1), [0, 1, 2, 3, 4]))
    .rejects.toThrow('Individual metadata record missing');
  expect(finished).toBe(3);
  expect(assets.fetch).toHaveBeenCalledTimes(4);
});


it('filters declared access independently of provider and preserves legacy evidence URLs', async () => {
  const index = fixtureIndex(2);
  index.sources[0].count = 1;
  index.sources.push({ ...index.sources[0], id: 'hf-gated-fixture-0123456789ab', access: 'gated',
    gatedPublicListing: true, start: 1, count: 1 });
  const gated = record(1); gated[1] = 1;
  const assets = { fetch: async () => Response.json([record(0), gated]) };
  for (const access of ['public', 'gated']) {
    const filters = individualFilters(new URLSearchParams({ access, provider: 'huggingface' }));
    const page = await searchIndividuals(assets, origin, index, filters);
    expect(page.total).toBe(1);
    expect(page.entries.map(entry => entry.access)).toEqual([access]);
  }
  expect((await searchIndividuals(assets, origin, index, new URLSearchParams('access=unknown'))).total).toBe(0);
  expect(individualFilters(new URLSearchParams('status=Access+required')).get('status')).toBe('Access required');
  expect(() => individualFilters(new URLSearchParams('access=private'))).toThrow('Invalid dataset access filter');
});
