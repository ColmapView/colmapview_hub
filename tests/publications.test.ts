import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { input, ip, listings, origin, post, request, resetState } from './helpers';
import { pendingPublicationKey } from '../src/worker/publications';
import { boundedBytes, verifyPublicationSource } from '../src/worker/publication-verification';
import { recordKey } from '../src/worker/records';
import { reviewPublication } from '../src/worker/publication-review';
import { clientIdentity } from '../src/worker/crypto';

const settings: Partial<Env> = { HUB_PUBLICATIONS_ENABLED: 'true', HUB_TURNSTILE_SITE_KEY: 'public-widget', HUB_TURNSTILE_SECRET: 'server-secret' };
const token = 'single-use-fixture';
const revision = 'a'.repeat(40);
const source = 'https://huggingface.co/datasets/owner/scene';
const viewerUrl = `${origin}/?url=${encodeURIComponent(source)}`;
const body = (overrides: Record<string, unknown> = {}) => ({ ...input({ viewerUrl }), listingAcknowledged: true, turnstileToken: token, ...overrides });
const submit = (payload = body(), overrides = settings) => request('/api/publications', { method: 'POST',
  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, ip, overrides);

function modelHeader(images = false): Uint8Array {
  const bytes = new Uint8Array(128); const view = new DataView(bytes.buffer);
  view.setBigUint64(0, 2n, true);
  if (!images) { view.setInt32(12, 1, true); view.setBigUint64(16, 640n, true); view.setBigUint64(24, 480n, true); view.setFloat64(32, 400, true); }
  else { view.setFloat64(12, 1, true); bytes[72] = 97; }
  return bytes;
}

function successfulReads() {
  return vi.mocked(fetch).mockImplementation(async (value) => {
    const url = String(value instanceof Request ? value.url : value);
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') return Response.json({ success: true, hostname: new URL(origin).hostname, action: 'hub-publication' });
    if (url === 'https://huggingface.co/api/datasets/owner/scene') return Response.json({ private: false, gated: false, sha: revision,
      siblings: [{ rfilename: 'sparse/0/cameras.bin' }, { rfilename: 'sparse/0/images.bin' }] });
    if (url.endsWith('/cameras.bin')) return new Response(modelHeader());
    if (url.endsWith('/images.bin')) return new Response(modelHeader(true));
    throw new Error('Unexpected request');
  });
}

beforeEach(resetState);

describe('public Hub submissions', () => {
  it('fails closed when configuration is absent and never opens a source', async () => {
    expect((await submit(body(), {})).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect(await (await request('/api/publications/config')).json()).toEqual({ enabled: false });
  });
  it.each([
    { listingAcknowledged: false }, { turnstileToken: '' }, { access: 'private' },
    { viewerUrl: `${origin}/?url=${encodeURIComponent('https://x.example/file.zip?access_token=do-not-save')}` },
  ])('rejects invalid submissions before saving anything: %j', async overrides => {
    expect((await submit(body(overrides))).status).toBe(400);
    expect((await env.LINKS.list({ prefix: 'listed/' })).objects).toHaveLength(0);
    expect((await env.LINKS.list({ prefix: 'pending-publications/' })).objects).toHaveLength(0);
  });
  it.each([
    { success: false }, { success: true, hostname: 'attacker.example', action: 'hub-publication' },
    { success: true, hostname: new URL(origin).hostname, action: 'other-action' },
  ])('requires a valid server challenge bound to the submitting hostname and action: %j', async result => {
    vi.mocked(fetch).mockResolvedValue(Response.json(result));
    expect((await submit()).status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await env.LINKS.list({ prefix: 'listed/' })).objects).toHaveLength(0);
  });
  it('does not accept dummy Turnstile secrets on a production host', async () => {
    expect((await submit(body(), { ...settings, HUB_TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' })).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects a foreign origin and caller-supplied verification evidence', async () => {
    const foreign = await request('/api/publications', { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: JSON.stringify(body()) }, ip, settings);
    expect(foreign.status).toBe(403);
    expect((await submit(body({ verification: { method: 'manual_review', checkedAt: new Date().toISOString() } }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('applies the creation quota before contacting challenge or dataset providers', async () => {
    for (let attempt = 0; attempt < 20; attempt++) expect((await submit(body({ listingAcknowledged: false }))).status).toBe(400);
    const response = await submit();
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('limits feed reads before storage access, using a hashed network identity', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const list = vi.spyOn(env.LINKS, 'list');
    const response = await request('/api/publications', {}, ip, { HUB_PUBLICATION_READS: { limit } });
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60');
    expect(limit).toHaveBeenCalledWith({ key: await clientIdentity(env.HUB_KEY, ip) });
    expect(list).not.toHaveBeenCalled();
  });
  it('verifies model headers, pins the checked revision and exposes only safe public metadata', async () => {
    successfulReads();
    const response = await submit(); expect(response.status).toBe(201);
    const [challengeUrl, challengeOptions] = vi.mocked(fetch).mock.calls[0];
    const challengeRequest = new Request(challengeUrl, challengeOptions);
    expect(challengeRequest.redirect).toBe('manual');
    const result = await response.json<{ id: string; status: string; shareUrl: string }>();
    expect(result.status).toBe('published');
    const object = await env.LINKS.get(recordKey(result.id));
    const record = await object!.json<Record<string, unknown>>();
    expect(record.verification).toMatchObject({ method: 'hf_colmap_headers', revision, cameras: 2, registeredImages: 2 });
    expect(new URL(String(record.viewerUrl)).searchParams.get('url')).toBe(`https://huggingface.co/datasets/owner/scene/resolve/${revision}/`);
    expect(JSON.stringify(record)).not.toContain(token); expect(record).not.toHaveProperty('managementSecret');
    const feed = await (await request('/api/publications')).json<{ entries: Record<string, unknown>[] }>();
    expect(feed.entries.map(entry => entry.id)).toEqual([result.id]);
    for (const name of ['ownerHash', 'fingerprint', 'managementSecret', 'thumbnailBase64']) expect(feed.entries[0]).not.toHaveProperty(name);
    const replay = await submit(); expect(replay.status).toBe(201); expect(await replay.json()).toEqual(result);
  });
  it('keeps arbitrary hosts pending and never contacts them', async () => {
    successfulReads();
    const response = await submit(body({ viewerUrl: `${origin}/?url=https://bucket.example/scene.zip` }));
    expect(response.status).toBe(202);
    const result = await response.json<{ id: string }>();
    expect(await env.LINKS.get(pendingPublicationKey(result.id))).not.toBeNull();
    expect((await env.LINKS.list({ prefix: 'listed/' })).objects).toHaveLength(0);
    expect((await (await request('/api/publications')).json<{ entries: unknown[] }>()).entries).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ private: true, gated: false }, { private: false, gated: 'auto' }])('rejects a private or gated HF source: %j', async access => {
    const reads = successfulReads();
    reads.mockImplementationOnce(async () => Response.json({ success: true, hostname: new URL(origin).hostname, action: 'hub-publication' }));
    reads.mockImplementationOnce(async () => Response.json({ ...access, sha: revision, siblings: [] }));
    expect((await submit()).status).toBe(422);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await env.LINKS.list({ prefix: 'listed/' })).objects).toHaveLength(0);
    expect((await env.LINKS.list({ prefix: 'pending-publications/' })).objects).toHaveLength(0);
  });
  it('keeps malformed model headers pending rather than claiming a valid dataset', async () => {
    const reads = successfulReads();
    reads.mockImplementation(async value => {
      const url = String(value);
      if (url.includes('siteverify')) return Response.json({ success: true, hostname: new URL(origin).hostname, action: 'hub-publication' });
      if (url.includes('/api/datasets/')) return Response.json({ private: false, gated: false, sha: revision,
        siblings: [{ rfilename: 'cameras.bin' }, { rfilename: 'images.bin' }] });
      return new Response(new Uint8Array(128));
    });
    const response = await submit(); expect(response.status).toBe(202);
    const result = await response.json<{ id: string }>();
    expect(await env.LINKS.get(recordKey(result.id))).toBeNull();
    expect(await env.LINKS.get(pendingPublicationKey(result.id))).not.toBeNull();
  });
  it('does not verify a different model in an ambiguous multi-scene repository', async () => {
    const reads = successfulReads();
    reads.mockImplementationOnce(async () => Response.json({ success: true, hostname: new URL(origin).hostname, action: 'hub-publication' }));
    reads.mockImplementationOnce(async () => Response.json({ private: false, gated: false, sha: revision,
      siblings: ['scene-a/cameras.bin', 'scene-a/images.bin', 'scene-b/cameras.bin', 'scene-b/images.bin'].map(rfilename => ({ rfilename })) }));
    expect((await submit()).status).toBe(202);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await env.LINKS.list({ prefix: 'listed/' })).objects).toHaveLength(0);
  });
  it('requires a fresh valid challenge even when replaying an existing submission', async () => {
    const reads = successfulReads(); expect((await submit()).status).toBe(201);
    reads.mockResolvedValueOnce(Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    expect((await submit()).status).toBe(403);
  });
  it.each(['http://data.example/file.zip', 'https://127.0.0.1/file.zip', 'https://[::1]/file.zip', 'https://printer.local/file.zip'])('refuses local or non-HTTPS source %s', async value => {
    successfulReads(); expect((await submit(body({ viewerUrl: `${origin}/?url=${encodeURIComponent(value)}` }))).status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not follow a provider redirect into a private or arbitrary network', async () => {
    const reads = successfulReads();
    reads.mockImplementationOnce(async () => Response.json({ success: true, hostname: new URL(origin).hostname, action: 'hub-publication' }));
    reads.mockImplementationOnce(async () => new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } }));
    expect((await submit()).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('does not enumerate private, unlisted, legacy unverified or pending records', async () => {
    await post(input({ access: 'private' })); await post(input({ managementSecret: 'B'.repeat(43) }));
    const legacy = await post(input({ listed: true, managementSecret: 'C'.repeat(43) }), ip, listings);
    expect(legacy.status).toBe(201);
    expect((await (await request('/api/publications')).json<{ entries: unknown[] }>()).entries).toEqual([]);
  });
  it('does not replay an older unverified gallery link as a verified publication', async () => {
    expect((await post(input({ viewerUrl, listed: true }), ip, listings)).status).toBe(201);
    successfulReads(); expect((await submit()).status).toBe(409);
  });
  it('bounds streamed responses even when length headers are absent or dishonest', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(100)); }, cancel });
    await expect(boundedBytes(new Response(stream), 128)).rejects.toThrow('needs review');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('checks a curated manifest through its fixed asset binding without an external request', async () => {
    const assets = { fetch: vi.fn(async () => Response.json({ version: 3 })) };
    const checked = await verifyPublicationSource(`${origin}/?url=${encodeURIComponent(`${origin}/hub/datasets/individual/manifests/${'a'.repeat(64)}.manifest.json`)}`,
      { ...env, CATALOG_ASSETS: assets } as unknown as Env, origin);
    expect(checked.verification?.method).toBe('catalog_manifest'); expect(fetch).not.toHaveBeenCalled();
  });
  it('publishes only a validated operator-reviewed record and strips private submission fields', () => {
    const record = { ...input(), id: 'HappyTree-LAAAAAAAAAAAAAAAA', listed: true, schemaVersion: 1,
      ownerHash: 'a'.repeat(64), fingerprint: 'b'.repeat(64), createdAt: new Date().toISOString(), reviewReason: 'Unknown source', turnstileToken: token };
    const approved = reviewPublication(record);
    expect(approved.verification?.method).toBe('manual_review');
    for (const field of ['managementSecret', 'turnstileToken', 'reviewReason', 'publicAcknowledged']) expect(approved).not.toHaveProperty(field);
    expect(() => reviewPublication({ ...record, access: 'private' })).toThrow('Invalid pending');
    expect(() => reviewPublication({ ...record, ownerHash: 'invalid' })).toThrow('Invalid pending');
    expect(() => reviewPublication({ ...record, viewerUrl: `${origin}/?url=https://localhost/private.zip` })).toThrow();
  });
});
