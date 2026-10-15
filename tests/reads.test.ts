import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordKey, resetWordlistCache, WORDLIST_KEY } from '../src/worker/records';
import { base64Bytes } from '../src/worker/validation';
import { preview } from './fixtures/preview';
import { create, input, ip, listings, post, remove, request, resetState } from './helpers';

beforeEach(async () => {
  await resetState();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
});
afterEach(() => { vi.restoreAllMocks(); });

async function rewrite(id: string, change: (record: Record<string, unknown>) => Record<string, unknown>) {
  const record = await (await env.LINKS.get(recordKey(id)))!.json<Record<string, unknown>>();
  await env.LINKS.put(recordKey(id), JSON.stringify(change(record)));
}

describe('tolerant reads', () => {
  it('renders and deletes a record that no longer meets creation rules', async () => {
    const link = await create(input());
    await rewrite(link.id, record => {
      delete record.description;
      delete record.listed;
      return { ...record, viewerUrl: 'https://old-viewer.example/?url=https%3A%2F%2Fdata.example%2Fscene.zip&token=legacy',
        license: { id: 'cc-by-4.0' }, assets: { format: 'unknown' }, futureField: { nested: true } };
    });
    const card = await request(`/${link.id}`);
    expect(card.status).toBe(200);
    const html = await card.text();
    expect(html).toContain('Demo reconstruction');
    expect(html).toContain('https://old-viewer.example/');
    expect(html).toContain('cc-by-4.0');
    expect((await request(`/${link.id}/preview.jpg`)).status).toBe(200);
    expect((await remove(link.id)).status).toBe(204);
  });

  it('answers 503 for a record it cannot render, without counting strikes, and logs only the error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const link = await create(input());
    await rewrite(link.id, record => { delete record.title; return record; });
    for (let index = 0; index < 4; index++) expect((await request(`/${link.id}`)).status).toBe(503);
    expect(error).toHaveBeenCalledTimes(4);
    for (const call of error.mock.calls) {
      expect(call).toEqual(['Unexpected Hub error', expect.any(Error)]);
      expect(JSON.stringify(call.map(String))).not.toContain(ip);
    }
    expect((await request('/missing-one')).status).toBe(404);
    expect((await request('/missing-two')).status).toBe(404);
  });

  it('serves the preview with a five-minute cache and never caches cards', async () => {
    const link = await create(input());
    const image = await request(`/${link.id}/preview.jpg`);
    expect(image.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(base64Bytes(preview));
    expect((await request(`/${link.id}`)).headers.get('Cache-Control')).toBe('no-store');
  });

  // workerd freezes timers during synchronous work, so this checks the one-pass decode's result, not its speed.
  it('decodes a 64 KiB preview string in one plain pass', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64 * 1024));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    expect(base64Bytes(btoa(binary))).toEqual(bytes);
  });

  it('keeps a record larger than the request limit readable, and refuses one past the record limit', async () => {
    const link = await create(input());
    await rewrite(link.id, record => ({ ...record, viewerUrl: `https://colmapview.opsiclear.com/?url=x${'a'.repeat(150 * 1024)}` }));
    expect((await request(`/${link.id}`)).status).toBe(200);
    await rewrite(link.id, record => ({ ...record, viewerUrl: `https://colmapview.opsiclear.com/?url=x${'a'.repeat(200 * 1024)}` }));
    expect((await request(`/${link.id}`)).status).toBe(503);
  });

  it('logs and skips an invalid gallery listing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const valid = await create(input({ listed: true, title: 'Listed result' }), ip, listings);
    await env.LINKS.put('listed/BadListing-LAAAAAAAAAAAAAAAA.json', '{}', { customMetadata: { title: '', createdAt: 'never' } });
    const page = await request('/', {}, ip, listings);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(valid.id);
    expect(warn).toHaveBeenCalledWith('Skipping an invalid listing', 'listed/BadListing-LAAAAAAAAAAAAAAAA.json', expect.any(Error));
  });

  it('reads the word lists once per isolate and retries after a failed read', async () => {
    await create(input());
    await env.LINKS.delete(WORDLIST_KEY);
    await create(input({ managementSecret: 'B'.repeat(43) }));
    resetWordlistCache();
    expect((await post(input({ managementSecret: 'C'.repeat(43) }))).status).toBe(503);
    await env.LINKS.put(WORDLIST_KEY, JSON.stringify({ version: 1, adjectives: ['calm'], nouns: ['river'] }));
    expect((await create(input({ managementSecret: 'D'.repeat(43) }))).id).toBe('CalmRiver');
  });

  it("never makes a request wait on another request's word-list read", async () => {
    let reading!: () => void;
    let release!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    // Stands in for a read whose request was cancelled: it settles only when released.
    const stalling = { put: env.LINKS.put.bind(env.LINKS),
      get: async (key: string) => { if (key === WORDLIST_KEY) { reading(); await gate; } return env.LINKS.get(key); } } as unknown as R2Bucket;
    const first = post(input(), ip, { LINKS: stalling });
    await started;
    const second = post(input({ managementSecret: 'B'.repeat(43) }));
    const outcome = await Promise.race([second.then(() => 'finished'), scheduler.wait(2000).then(() => 'waited')]);
    release();
    expect([(await first).status, (await second).status]).toEqual([201, 201]);
    expect(outcome).toBe('finished');
  });

  it('accepts word lists larger than the request limit', async () => {
    const letters = (value: number) => value.toString(26).split('').map(digit => String.fromCharCode(97 + Number.parseInt(digit, 26))).join('');
    const nouns = Array.from({ length: 8192 }, (_, index) => `noun${letters(index).padStart(10, 'a')}`);
    const body = JSON.stringify({ version: 1, adjectives: ['calm'], nouns });
    expect(body.length).toBeGreaterThan(128 * 1024);
    await env.LINKS.put(WORDLIST_KEY, body);
    resetWordlistCache();
    expect((await create(input())).id).toMatch(/^Calm[A-Z][a-z]+$/);
  });
});
