import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, listDurableObjectIds, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ID_PATTERN, MAX_REQUEST_BYTES } from '../src/shared/model';
import type { CreateLinkInput } from '../src/shared/model';
import { clientIdentity } from '../src/worker/crypto';
import { recordKey, WORDLIST_KEY } from '../src/worker/records';
import { preview } from './fixtures/preview';

const origin = 'https://colmapview.opsiclear.com';
const base = `${origin}/hub`;
const ip = '192.0.2.1';
const owner = 'A'.repeat(43);
interface LinkResult { id: string; url: string; managementPath: string }

function input(overrides: Partial<CreateLinkInput> = {}): CreateLinkInput {
  return { viewerUrl: `${origin}/?url=https%3A%2F%2Fdata.example%2Fmanifest.json#camera=43`, title: 'Demo reconstruction', description: 'A small test scene.', thumbnailBase64: preview, managementSecret: owner, turnstileToken: 'verified-token', publicAcknowledged: true, ...overrides };
}

function request(path: string, init: RequestInit = {}, clientIp = ip): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', clientIp);
  if (init.method === 'POST' || init.method === 'DELETE' || init.method === 'OPTIONS') {
    if (!headers.has('Origin')) headers.set('Origin', origin);
  }
  return exports.default.fetch(new Request(`${base}${path}`, { ...init, headers }));
}

async function create(payload = input(), clientIp = ip): Promise<LinkResult> {
  const response = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, clientIp);
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json<LinkResult>();
}

async function guard(clientIp = ip) { return env.CLIENT_GUARDS.getByName(await clientIdentity(env.HUB_KEY, clientIp)); }

beforeEach(async () => {
  // The current plugin's exported Worker bindings retain storage across tests.
  // Reset only this local fixture's bucket and actors, never production resources.
  for (const object of (await env.LINKS.list()).objects) await env.LINKS.delete(object.key);
  for (const id of await listDurableObjectIds(env.CLIENT_GUARDS)) {
    await runInDurableObject(env.CLIENT_GUARDS.get(id), async (_, state) => {
      state.storage.sql.exec('DELETE FROM misses');
      state.storage.sql.exec('UPDATE guard SET blockedUntil = 0, creationStarted = 0, creationCount = 0');
      await state.storage.deleteAlarm();
    });
  }
  await env.LINKS.put(WORDLIST_KEY, JSON.stringify({ version: 1, adjectives: ['happy', 'funny'], nouns: ['tree', 'ball'] }));
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ success: true, hostname: 'colmapview.opsiclear.com', action: 'create-link' }));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('unlisted records and social cards', () => {
  it('saves one base64 record, emits an HTML card and public JPEG, and preserves the viewer fragment and license', async () => {
    const payload = input({ license: { id: 'cc-by-4.0', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } });
    const link = await create(payload);
    expect(ID_PATTERN.test(link.id)).toBe(true);
    expect(link.url).toBe(`${base}/${link.id}`);
    const stored = await env.LINKS.get(recordKey(link.id));
    const raw = await stored!.text();
    expect(raw).toContain('thumbnailBase64');
    expect(raw).not.toContain('managementSecret');
    expect(raw).not.toContain('turnstileToken');
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(1);
    const card = await request(`/${link.id}`);
    const html = await card.text();
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(`property="og:image" content="${link.url}/preview.jpg"`);
    expect(html).toContain('#camera=43');
    expect(html).toContain('CC BY 4.0');
    expect(html).not.toContain('ownerHash');
    expect(html).not.toContain('managementSecret');
    const image = await request(`/${link.id}/preview.jpg`);
    expect(image.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(Uint8Array.from(atob(preview), character => character.charCodeAt(0)));
    const head = await request(`/${link.id}/preview.jpg`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  });

  it('replays a lost creation response without another record or another captcha, and refuses changed drafts', async () => {
    const first = await create();
    const second = await create(input({ turnstileToken: '' }));
    expect(second).toEqual(first);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(1);
    const changed = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input({ title: 'Changed' })) });
    expect(changed.status).toBe(409);
    expect(await (await request(`/${first.id}`)).text()).toContain('Demo reconstruction');
  });

  it('creates unrelated IDs for separate ownership keys and handles concurrent identical submissions atomically', async () => {
    const [one, two] = await Promise.all([create(), create()]);
    expect(one.id).toBe(two.id);
    const other = await create(input({ managementSecret: 'B'.repeat(43) }));
    expect(other.id).not.toBe(one.id);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(2);
  });

  it('does not overwrite a record when concurrent drafts reuse an ownership key', async () => {
    const responses = await Promise.all(['First', 'Second'].map(title => request('/api/links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input({ title })),
    })));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(1);
  });

  it('escapes supplied metadata and never exposes ownership material on public pages', async () => {
    const link = await create(input({ title: '"><script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' }));
    const html = await (await request(`/${link.id}`)).text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain(owner);
    expect((await request(`/${link.id}`)).headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  it('does not provide listing, search, sitemap, or private wordlist endpoints', async () => {
    const link = await create();
    for (const path of ['/api/links', '/api/search', '/assets/internal.json', '/internal/wordlists-v1.json']) {
      const response = await request(path);
      expect([404, 429]).toContain(response.status);
      const body = await response.text();
      expect(body).not.toContain(link.id);
      expect(body).not.toContain('adjectives');
    }
  });
});

describe('three-distinct-miss guard', () => {
  it('counts repeated page, image and HEAD misses once, then blocks every lookup surface', async () => {
    const link = await create();
    expect((await request('/missing')).status).toBe(404);
    expect((await request('/missing/preview.jpg')).status).toBe(404);
    expect((await request('/missing', { method: 'HEAD' })).status).toBe(404);
    expect((await request(`/${link.id}`)).status).toBe(200);
    expect((await request('/another')).status).toBe(404);
    const third = await request('/third');
    expect(third.status).toBe(429);
    expect(Number(third.headers.get('Retry-After'))).toBeGreaterThanOrEqual(599);
    for (const path of [`/${link.id}`, `/${link.id}/preview.jpg`, '/fourth']) {
      for (const method of ['GET', 'HEAD']) expect((await request(path, { method })).status).toBe(429);
    }
    expect((await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input()) })).status).toBe(429);
    expect((await request(`/api/links/${link.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } })).status).toBe(429);
    expect((await request(`/${link.id}`, {}, '192.0.2.2')).status).toBe(200);
    expect(third.headers.get('Cache-Control')).toBe('no-store');
  });

  it('does not let concurrent misses reset the counter or evade the cooldown', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => request(`/missing-${index}`)));
    expect(responses.filter(response => response.status === 404).length).toBeLessThanOrEqual(2);
    expect(responses.filter(response => response.status === 429).length).toBeGreaterThanOrEqual(10);
    expect(await (await guard()).check()).toBeGreaterThan(0);
    const rows = await runInDurableObject(await guard(), (_, state) => state.storage.sql.exec<{ fingerprint: string; at: number }>('SELECT * FROM misses').toArray());
    expect(rows).toHaveLength(3);
    expect(rows.every(row => /^[a-f0-9]{64}$/.test(row.fingerprint))).toBe(true);
  });

  it('persists strikes across Durable Object eviction', async () => {
    await request('/first');
    await request('/second');
    const stub = await guard();
    await evictDurableObject(stub);
    expect((await request('/third')).status).toBe(429);
  });

  it('expires cooldowns and old guesses, and cleans up with an alarm', async () => {
    const link = await create();
    await request('/first'); await request('/second'); await request('/third');
    const stub = await guard();
    await runInDurableObject(stub, (_, state) => {
      state.storage.sql.exec('UPDATE guard SET blockedUntil = ?, creationStarted = ?, creationCount = 0', Date.now() - 1, Date.now() - 3600001);
      state.storage.sql.exec('UPDATE misses SET at = ?', Date.now() - 600001);
    });
    expect((await request(`/${link.id}`)).status).toBe(200);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runInDurableObject(stub, (_, state) => state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM misses').one().count)).toBe(0);
  });

  it('counts malformed IDs uniformly, while static misses and storage failures do not become strikes', async () => {
    const link = await create();
    for (let index = 0; index < 4; index++) expect((await request(`/assets/absent-${index}.js`)).status).toBe(404);
    await env.LINKS.put(recordKey(link.id), 'not-json');
    for (let index = 0; index < 4; index++) expect((await request(`/${link.id}`)).status).toBe(503);
    expect(await (await guard()).check()).toBe(0);
    expect((await request('/%E0%A4%A')).status).toBe(404);
    expect((await request('/malformed')).status).toBe(404);
    expect((await request('/third')).status).toBe(429);
  });

  it('does not exempt fake crawler User-Agents, and valid social-card fetches add no strikes', async () => {
    const link = await create();
    for (let index = 0; index < 6; index++) {
      expect((await request(`/${link.id}`, { headers: { 'User-Agent': 'Twitterbot/1.0' } })).status).toBe(200);
      expect((await request(`/${link.id}/preview.jpg`, { method: 'HEAD', headers: { 'User-Agent': 'Twitterbot/1.0' } })).status).toBe(200);
    }
    await request('/one'); await request('/two'); await request('/three');
    expect((await request(`/${link.id}`, { headers: { 'User-Agent': 'Twitterbot/1.0' } })).status).toBe(429);
  });
});

describe('ownership and request validation', () => {
  it('deletes the whole record only with the management key', async () => {
    const link = await create();
    const denied = await request(`/api/links/${link.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${'B'.repeat(43)}` } });
    const missing = await request('/api/links/UnknownTree-AAAAAAAAAAAAAAAA', { method: 'DELETE', headers: { Authorization: `Bearer ${'B'.repeat(43)}` } }, '192.0.2.2');
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe(await missing.text());
    const deleted = await request(`/api/links/${link.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } });
    expect(deleted.status).toBe(204);
    expect(await env.LINKS.get(recordKey(link.id))).toBeNull();
    expect((await request(`/${link.id}`)).status).toBe(404);
  });

  it('makes unauthorized deletion counters independent of record existence', async () => {
    const one = await create();
    const two = await create(input({ managementSecret: 'B'.repeat(43) }));
    const guesses = [one.id, two.id, 'UnknownTree-AAAAAAAAAAAAAAAA'];
    for (let index = 0; index < guesses.length; index++) {
      const response = await request(`/api/links/${guesses[index]}`, { method: 'DELETE', headers: { Authorization: `Bearer ${'C'.repeat(43)}` } });
      expect(response.status).toBe(index === 2 ? 429 : 404);
    }
  });

  it.each([
    { viewerUrl: 'https://evil.example/?url=anything' },
    { viewerUrl: `${origin}/?access_token=private` },
    { thumbnailBase64: btoa('<svg onload="alert(1)">') },
    { publicAcknowledged: false },
    { id: 'HappyTree-chosenbycaller' },
    { license: { name: 'License', url: 'javascript:alert(1)' } },
  ])('rejects invalid or unsafe input without saving a record: %j', async override => {
    const response = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input(), ...override }) });
    expect(response.status).toBe(400);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('enforces the actual body limit without trusting Content-Length', async () => {
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(MAX_REQUEST_BYTES + 1))); controller.close(); } });
    const response = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect(response.status).toBe(413);
    const unsupported = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json-bad' }, body: '{}' });
    expect(unsupported.status).toBe(415);
  });

  it('validates Turnstile hostname/action and requires an allowed browser origin', async () => {
    vi.mocked(fetch).mockImplementation(async () => Response.json({ success: true, hostname: 'evil.example', action: 'create-link' }));
    expect((await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input()) })).status).toBe(403);
    const forbidden = await request('/api/links', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.has('Access-Control-Allow-Origin')).toBe(false);
    const preflight = await request('/api/links', { method: 'OPTIONS', headers: { Origin: 'https://colmapview.github.io' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://colmapview.github.io');
  });

  it('limits malformed creation attempts before parsing their bodies', async () => {
    for (let index = 0; index < 20; index++) {
      const response = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
      expect(response.status).toBe(400);
    }
    const denied = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({ error: 'Too many attempts. Try again later.' });
    expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThan(3500);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect((await create(input(), '192.0.2.2')).id).toMatch(ID_PATTERN);
  });

  it('bounds streamed verification responses and treats upstream failures as unavailable', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(8193))); controller.close(); },
    }), { headers: { 'Content-Type': 'application/json' } }));
    const response = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
    expect(response.status).toBe(503);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(0);
    expect(await (await guard()).check()).toBe(0);
  });
});
