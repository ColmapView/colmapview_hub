import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECORD_BYTES } from '../src/shared/model';
import { recordKey } from '../src/worker/records';
import { assets, create, input, ip, listings, origin, post, remove, request, resetState } from './helpers';

beforeEach(async () => {
  await resetState();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
});
afterEach(() => { vi.restoreAllMocks(); });

const stored = async (id: string) => (await env.LINKS.get(recordKey(id)))!.json<Record<string, unknown>>();
const recordCount = async () => (await env.LINKS.list({ prefix: 'links/' })).objects.length
  + (await env.LINKS.list({ prefix: 'listed/' })).objects.length;

describe('creation contract', () => {
  it('treats a request without access as public and stores access only on private links', async () => {
    const legacy = await create(input());
    const explicit = await create(input({ access: 'public', managementSecret: 'B'.repeat(43) }));
    const hidden = await create(input({ access: 'private', managementSecret: 'C'.repeat(43) }));
    expect((await stored(legacy.id)).access).toBeUndefined();
    expect((await stored(explicit.id)).access).toBeUndefined();
    expect((await stored(hidden.id)).access).toBe('private');
  });

  it.each(['shared', '', null, true, 'PRIVATE'])('rejects access %j without saving a record', async access => {
    expect((await post({ ...input(), access })).status).toBe(400);
    expect(await recordCount()).toBe(0);
  });

  it('refuses a listed private link with 400, and any listing with 403 while listings are off', async () => {
    expect((await post(input({ access: 'private', listed: true }), ip, listings)).status).toBe(400);
    const off = await post(input({ listed: true }));
    expect(off.status).toBe(403);
    expect(await off.json()).toEqual({ error: 'Listings are turned off.' });
    expect(await recordCount()).toBe(0);
    expect((await create(input({ listed: true }), ip, listings)).id).toMatch(/-L[A-Za-z0-9_-]{16}$/);
  });

  it.each(['X-Amz-Signature', 'x-amz-credential', 'X-Amz-Security-Token', 'x-goog-signature', 'X-Goog-Credential',
    'sig', 'signature', 'token', 'AWSAccessKeyId'])('rejects the %s credential parameter in the viewer URL, its source, and either fragment', async name => {
    const source = 'https://data.example/scene.zip';
    for (const viewerUrl of [
      `${origin}/?url=${encodeURIComponent(`${source}?${name}=secret`)}`,
      `${origin}/?url=${encodeURIComponent(`${source}#${name}=secret`)}`,
      `${origin}/?url=${encodeURIComponent(source)}&${name}=secret`,
      `${origin}/?url=${encodeURIComponent(source)}#${name}=secret`,
    ]) expect((await post(input({ viewerUrl }))).status, viewerUrl).toBe(400);
    expect(await recordCount()).toBe(0);
  });

  it('keeps camera fragments and ordinary source parameters', async () => {
    const link = await create(input({ viewerUrl: `${origin}/?url=${encodeURIComponent('https://data.example/scene.zip?download=1')}#camera=43` }));
    expect((await stored(link.id)).viewerUrl).toContain('#camera=43');
  });

  it.each([
    { field: 'viewer', limit: 32768, link: `${origin}/?url=${'€'.repeat(4000)}`, payload: (link: string) => input({ viewerUrl: link }),
      error: 'Enter a valid ColmapView link.' },
    { field: 'license', limit: 2048, link: `https://licenses.example/${'€'.repeat(300)}`, payload: (link: string) => input({ license: { url: link } }),
      error: 'License link is invalid.' },
  ])('refuses a $field link that passes its limit only once normalized, without saving a record', async ({ limit, link, payload, error }) => {
    // Normalizing percent-encodes each '€' as nine characters.
    expect(link.length).toBeLessThanOrEqual(limit);
    expect(new URL(link).href.length).toBeGreaterThan(limit);
    const response = await post(payload(link));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(await recordCount()).toBe(0);
  });

  it('stores a request at its size limits under the record limit, and keeps it readable and deletable', async () => {
    const viewerUrl = `${origin}/?url=${'a'.repeat(32000)}`;
    const license = { id: '€'.repeat(80), name: '€'.repeat(160), url: `https://licenses.example/${'a'.repeat(2048 - 25)}` };
    expect(license.url).toHaveLength(2048);
    const link = await create(input({ viewerUrl, title: '€'.repeat(120), description: '€'.repeat(280), license, assets }));
    expect((await env.LINKS.head(recordKey(link.id)))!.size).toBeLessThan(MAX_RECORD_BYTES);
    expect((await request(`/${link.id}`)).status).toBe(200);
    expect((await remove(link.id)).status).toBe(204);
    expect(await recordCount()).toBe(0);
  });
});
