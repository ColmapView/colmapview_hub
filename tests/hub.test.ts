import { env } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ID_PATTERN, isListedId, MAX_REQUEST_BYTES } from '../src/shared/model';
import type { LinkRecord } from '../src/shared/model';
import { base64Url, deriveLongId, deriveShortId } from '../src/worker/crypto';
import { recordKey, resetWordlistCache, WORDLIST_KEY } from '../src/worker/records';
import { preview } from './fixtures/preview';
import { assets, base, create, guard, input, ip, listings, origin, owner, request, resetState, words } from './helpers';

beforeEach(async () => {
  await resetState();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
});
afterEach(() => { vi.restoreAllMocks(); });

describe('unlisted records and social cards', () => {
  it('stores and displays asset types, counts, format and model statistics in the card and social metadata', async () => {
    const link = await create(input({ assets }));
    const record = await (await env.LINKS.get(recordKey(link.id)))!.json<Record<string, unknown>>();
    expect(record.assets).toEqual(assets);
    const html = await (await request(`/${link.id}`)).text();
    expect(html).toContain('aria-label="Dataset assets"');
    expect(html).toContain('5 COLMAP files (83 cameras, 83,749 points)');
    expect(html).toContain('83 images (JPEG) · 82 masks · 1 Gaussian splat · Viewer settings');
    expect(html).toMatch(/name="twitter:description" content="[^"]*83 images \(JPEG\)/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('retries summaries with reordered fields idempotently and refuses changed counts', async () => {
    const first = await create(input({ assets }));
    expect(await create(input({ assets: { ...assets, colmap: { points: 83749, cameras: 83, files: 5 } } }))).toEqual(first);
    const changed = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input({ assets: { ...assets, images: 84 } })) });
    expect(changed.status).toBe(409);
    expect(await (await env.LINKS.get(recordKey(first.id)))!.json<Record<string, unknown>>()).toMatchObject({ assets });
  });

  it.each([
    null, { ...assets, images: -1 }, { ...assets, masks: 1.5 }, { ...assets, splats: Number.MAX_SAFE_INTEGER + 1 },
    { ...assets, imageFormat: 'unknown' }, { ...assets, format: 'folder' }, { ...assets, viewerSettings: 'true' },
    { ...assets, colmap: { ...assets.colmap, files: '5' } }, { ...assets, paths: ['private.jpg'] },
  ])('rejects malformed asset summaries without saving a record: %j', async summary => {
    const response = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input(), assets: summary }) });
    expect(response.status).toBe(400);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(0);
  });

  it('preserves legacy fingerprints and cards without inventing asset counts', async () => {
    const payload = input();
    const link = await create(payload);
    const record = await (await env.LINKS.get(recordKey(link.id)))!.json<Record<string, unknown>>();
    const legacyFingerprint = JSON.stringify([payload.viewerUrl, payload.title, payload.description, payload.thumbnailBase64, '', '', '']);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacyFingerprint));
    expect(record.fingerprint).toBe([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
    expect(await create(payload)).toEqual(link);
    expect(await (await request(`/${link.id}`)).text()).not.toContain('aria-label="Dataset assets"');
  });
  it('saves one base64 record, emits an HTML card and public JPEG, and preserves the viewer fragment and license', async () => {
    const payload = input({ license: { id: 'cc-by-4.0', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } });
    const link = await create(payload);
    expect(ID_PATTERN.test(link.id)).toBe(true);
    expect(link.id).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
    expect(link.url).toBe(`${base}/${link.id}`);
    const stored = await env.LINKS.get(recordKey(link.id));
    const raw = await stored!.text();
    expect(raw).toContain('thumbnailBase64');
    expect(raw).not.toContain('managementSecret');
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
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('replays a lost creation response without another record, and refuses changed drafts', async () => {
    const first = await create();
    const second = await create();
    expect(second).toEqual(first);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
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

  it('allocates colliding word pairs atomically and replays the assigned name after the first vacancy returns', async () => {
    const small = { adjectives: ['happy', 'funny'], nouns: ['tree', 'ball'] };
    await env.LINKS.put(WORDLIST_KEY, JSON.stringify({ version: 1, ...small }));
    resetWordlistCache();
    const firstChoice = await deriveShortId(env.HUB_KEY, owner, small, 0);
    let otherOwner = '';
    for (let index = 1; index < 256; index++) {
      const secret = base64Url(new Uint8Array(32).fill(index));
      if (await deriveShortId(env.HUB_KEY, secret, small, 0) === firstChoice) { otherOwner = secret; break; }
    }
    expect(otherOwner).not.toBe('');
    const payloads = [input(), input({ managementSecret: otherOwner, title: 'Other result' })];
    const links = await Promise.all(payloads.map(payload => create(payload)));
    expect(new Set(links.map(link => link.id)).size).toBe(2);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(2);
    for (const [index, link] of links.entries()) expect(await (await request(`/${link.id}`)).text()).toContain(payloads[index].title);
    const winner = links.findIndex(link => link.id === firstChoice);
    expect(winner).toBeGreaterThanOrEqual(0);
    await request(`/api/links/${links[winner].id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${payloads[winner].managementSecret}` } });
    const remaining = 1 - winner;
    expect(await create(payloads[remaining])).toEqual(links[remaining]);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(1);
    const changed = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payloads[remaining], title: 'Changed after collision' }) });
    expect(changed.status).toBe(409);
  });

  it('fails bounded allocation without replacing a link when all candidate names are occupied', async () => {
    await env.LINKS.put(WORDLIST_KEY, JSON.stringify({ version: 1, adjectives: ['happy'], nouns: ['tree'] }));
    resetWordlistCache();
    const original = await create();
    const blocked = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input({ managementSecret: 'B'.repeat(43), title: 'Replacement' })) });
    expect(blocked.status).toBe(409);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(1);
    expect(await (await request(`/${original.id}`)).text()).toContain('Demo reconstruction');
    expect(await (await guard()).check()).toBe(0);
  });

  it('treats seventeen-letter word-pair names as unlisted across reading, previews and deletion', async () => {
    await env.LINKS.put(WORDLIST_KEY, JSON.stringify({ version: 1, adjectives: ['bright'], nouns: ['watermelons'] }));
    resetWordlistCache();
    const link = await create();
    expect(link.id).toBe('BrightWatermelons');
    expect(link.id).toHaveLength(17);
    expect(isListedId(link.id)).toBe(false);
    expect(await env.LINKS.get(`links/${link.id}.json`)).not.toBeNull();
    expect((await request(`/${link.id}`)).status).toBe(200);
    expect((await request(`/${link.id}/preview.jpg`, { method: 'HEAD' })).status).toBe(200);
    expect((await request(`/api/links/${link.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } })).status).toBe(204);
  });

  it('keeps legacy suffixed links readable and deletable, and replays them for private requests', async () => {
    const link = await create();
    const record = await (await env.LINKS.get(recordKey(link.id)))!.json<LinkRecord>();
    const legacyId = await deriveLongId(env.HUB_KEY, owner, words);
    await env.LINKS.delete(recordKey(link.id));
    await env.LINKS.put(recordKey(legacyId), JSON.stringify({ ...record, id: legacyId }));
    expect((await request(`/${legacyId}`)).status).toBe(200);
    expect((await request(`/${legacyId}/preview.jpg`, { method: 'HEAD' })).status).toBe(200);
    expect(await create(input({ access: 'private' }))).toEqual({ id: legacyId, url: `${base}/${legacyId}`, managementPath: `/hub/manage/${legacyId}` });
    expect((await request(`/api/links/${legacyId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } })).status).toBe(204);
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

  it('does not provide unlisted-link search or private wordlist endpoints', async () => {
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

  it('requires an allowed browser origin without human verification', async () => {
    const forbidden = await request('/api/links', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.has('Access-Control-Allow-Origin')).toBe(false);
    const preflight = await request('/api/links', { method: 'OPTIONS', headers: { Origin: 'https://colmapview.github.io' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://colmapview.github.io');
    expect((await request('/api/links', { method: 'POST', headers: { Origin: 'https://colmapview.github.io', 'Content-Type': 'application/json' }, body: JSON.stringify(input()) })).status).toBe(201);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
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

  it('retains the creation quota for valid uploads without verification', async () => {
    for (let index = 0; index < 20; index++) await create(input({ managementSecret: 'A'.repeat(42) + String.fromCharCode(65 + index) }));
    const denied = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input({ managementSecret: 'Z'.repeat(43) })) });
    expect(denied.status).toBe(429);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(20);
  });
});

describe('opt-in results gallery', () => {
  it('has no submission form and shows only explicit listings', async () => {
    const unlisted = await create();
    const listed = await create(input({ listed: true, title: 'Public result', managementSecret: 'B'.repeat(43), assets }), ip, listings);
    const html = await (await request('/', {}, ip, listings)).text();
    expect(html).toContain(listed.id);
    expect(html).toContain('Public result');
    expect(html).toContain('5 COLMAP files · 83 images (JPEG) · 82 masks · 1 Gaussian splat');
    expect(html).not.toContain(unlisted.id);
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain('create-link');
    expect(html).not.toContain('challenges.cloudflare.com');
    expect(await env.LINKS.get(recordKey(listed.id))).not.toBeNull();
    const deleted = await request(`/api/links/${listed.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${'B'.repeat(43)}` } });
    expect(deleted.status).toBe(204);
    expect(await (await request('/', {}, ip, listings)).text()).not.toContain(listed.id);
    expect((await request(`/${unlisted.id}`)).status).toBe(200);
  });

  it('separates public and unlisted IDs even when an owner reuses a management key', async () => {
    const unlisted = await create();
    const listed = await create(input({ listed: true }), ip, listings);
    expect(listed.id).not.toBe(unlisted.id);
    expect(listed.id.replace('-L', '-')).not.toBe(unlisted.id);
    expect((await env.LINKS.list({ prefix: 'listed/' })).objects).toHaveLength(1);
    expect((await env.LINKS.list({ prefix: 'links/' })).objects).toHaveLength(1);
    expect(await create(input({ listed: true }), ip, listings)).toEqual(listed);
  });

  it('paginates only opted-in records without exposing unlisted keys or cursor data', async () => {
    const privateLink = await create();
    const listed = [];
    for (let index = 0; index < 13; index++) listed.push(await create(input({ listed: true, title: `Result ${index}`, managementSecret: 'B'.repeat(42) + String.fromCharCode(65 + index) }), ip, listings));
    const first = await (await request('/', {}, ip, listings)).text();
    const next = first.match(/href="\/hub\/\?cursor=([^"]+)"/);
    expect(next).not.toBeNull();
    const second = await (await request(`/?cursor=${next![1]}`, {}, ip, listings)).text();
    expect(listed.filter(link => first.includes(link.id))).toHaveLength(12);
    expect(listed.filter(link => second.includes(link.id))).toHaveLength(1);
    expect(first + second).not.toContain(privateLink.id);
    expect(decodeURIComponent(next![1])).not.toContain(privateLink.id);
  });

  it('continues to read existing unlisted records that predate the listing field', async () => {
    const link = await create();
    const record = await (await env.LINKS.get(recordKey(link.id)))!.json<Record<string, unknown>>();
    delete record.listed;
    await env.LINKS.put(recordKey(link.id), JSON.stringify(record));
    expect((await request(`/${link.id}`)).status).toBe(200);
    expect(await (await request('/', {}, ip, listings)).text()).not.toContain(link.id);
  });
});
