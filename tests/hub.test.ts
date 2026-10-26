import { hubStorage } from '../src/worker/storage';
import { env } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ID_PATTERN, isListedId, MAX_REQUEST_BYTES } from '../src/shared/model';
import type { LinkRecord } from '../src/shared/model';
import { base64Url, deriveLongId, deriveShortId } from '../src/worker/crypto';
import type { GuardState } from '../src/worker/guard';
import { recordKey, resetWordlistCache, WORDLIST_KEY } from '../src/worker/records';
import { preview } from './fixtures/preview';
import { assets, base, create, guard, input, origin, owner, request, resetState, words } from './helpers';

beforeEach(resetState);

describe('unlisted records and social cards', () => {
  it('stores the asset summary and shows its nonzero counts', async () => {
    const link = await create(input({ assets }));
    const record = await (await hubStorage.get(env.HUB_DB, recordKey(link.id)))!.json<Record<string, unknown>>();
    expect(record.assets).toEqual(assets);
    const html = await (await request(`/${link.id}`)).text();
    expect(html).toContain('83 images · 83,749 points · 82 masks · 1 splat');
    expect(html).toContain('<meta name="twitter:description" content="A small test scene.">');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('retries summaries with reordered fields idempotently and refuses changed counts', async () => {
    const first = await create(input({ assets }));
    expect(await create(input({ assets: { ...assets, colmap: { points: 83749, cameras: 83, files: 5 } } }))).toEqual(first);
    const changed = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input({ assets: { ...assets, images: 84 } })) });
    expect(changed.status).toBe(409);
    expect(await (await hubStorage.get(env.HUB_DB, recordKey(first.id)))!.json<Record<string, unknown>>()).toMatchObject({ assets });
  });

  it.each([
    null, { ...assets, images: -1 }, { ...assets, masks: 1.5 }, { ...assets, splats: Number.MAX_SAFE_INTEGER + 1 },
    { ...assets, imageFormat: 'unknown' }, { ...assets, format: 'folder' }, { ...assets, viewerSettings: 'true' },
    { ...assets, colmap: { ...assets.colmap, files: '5' } }, { ...assets, paths: ['private.jpg'] },
  ])('rejects malformed asset summaries without saving a record: %j', async summary => {
    const response = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input(), assets: summary }) });
    expect(response.status).toBe(400);
    expect((await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1000 })).objects).toHaveLength(0);
  });

  it('preserves legacy fingerprints and cards without inventing asset counts', async () => {
    const payload = input();
    const link = await create(payload);
    const record = await (await hubStorage.get(env.HUB_DB, recordKey(link.id)))!.json<Record<string, unknown>>();
    const legacyFingerprint = JSON.stringify([payload.viewerUrl, payload.title, payload.description, payload.thumbnailBase64, '', '', '']);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacyFingerprint));
    expect(record.fingerprint).toBe([...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
    expect(await create(payload)).toEqual(link);
    expect(await (await request(`/${link.id}`)).text()).not.toContain('class="meta"');
  });
  it('stores metadata and binary preview together, emits an HTML card and JPEG, and preserves the fragment and license', async () => {
    const payload = input({ license: { id: 'cc-by-4.0', name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } });
    const link = await create(payload);
    expect(ID_PATTERN.test(link.id)).toBe(true);
    expect(link.id).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+$/);
    expect(link.url).toBe(`${base}/${link.id}`);
    const stored = await env.HUB_DB.prepare('SELECT body_json, length(preview_jpeg) AS bytes FROM hub_entries WHERE namespace = ? AND id = ?')
      .bind('links', link.id).first<{ body_json: string; bytes: number }>();
    expect(stored!.body_json).not.toContain('thumbnailBase64');
    expect(stored!.body_json).not.toContain('managementSecret');
    expect(stored!.bytes).toBe(atob(payload.thumbnailBase64).length);
    expect((await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1000 })).objects).toHaveLength(1);
    const card = await request(`/${link.id}`);
    const html = await card.text();
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(`property="og:image" content="${link.shareUrl}/preview.jpg"`);
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
    expect((await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1000 })).objects).toHaveLength(1);
    const changed = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input({ title: 'Changed' })) });
    expect(changed.status).toBe(409);
    expect(await (await request(`/${first.id}`)).text()).toContain('Demo reconstruction');
  });

  it('creates unrelated IDs for separate ownership keys and handles concurrent identical submissions atomically', async () => {
    const [one, two] = await Promise.all([create(), create()]);
    expect(one.id).toBe(two.id);
    const other = await create(input({ managementSecret: 'B'.repeat(43) }));
    expect(other.id).not.toBe(one.id);
    expect((await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1000 })).objects).toHaveLength(2);
  });

  it('allocates colliding word pairs atomically and replays the assigned name after the first vacancy returns', async () => {
    const small = { adjectives: ['happy', 'funny'], nouns: ['tree', 'ball'] };
    await hubStorage.put(env.HUB_DB, WORDLIST_KEY, JSON.stringify({ version: 1, ...small }));
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
    expect((await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1000 })).objects).toHaveLength(2);
    for (const [index, link] of links.entries()) expect(await (await request(`/${link.id}`)).text()).toContain(payloads[index].title);
    const winner = links.findIndex(link => link.id === firstChoice);
    expect(winner).toBeGreaterThanOrEqual(0);
    await request(`/api/links/${links[winner].id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${payloads[winner].managementSecret}` } });
    const remaining = 1 - winner;
    expect(await create(payloads[remaining])).toEqual(links[remaining]);
    expect((await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1000 })).objects).toHaveLength(1);
    const changed = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payloads[remaining], title: 'Changed after collision' }) });
    expect(changed.status).toBe(409);
  });

  it('fails bounded allocation without replacing a link when all candidate names are occupied', async () => {
    await hubStorage.put(env.HUB_DB, WORDLIST_KEY, JSON.stringify({ version: 1, adjectives: ['happy'], nouns: ['tree'] }));
    resetWordlistCache();
    const original = await create();
    const blocked = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input({ managementSecret: 'B'.repeat(43), title: 'Replacement' })) });
    expect(blocked.status).toBe(409);
    expect((await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1000 })).objects).toHaveLength(1);
    expect(await (await request(`/${original.id}`)).text()).toContain('Demo reconstruction');
    expect(await (await guard()).lookup(null)).toBe(0);
  });

  it('treats seventeen-letter word-pair names as unlisted across reading, previews and deletion', async () => {
    await hubStorage.put(env.HUB_DB, WORDLIST_KEY, JSON.stringify({ version: 1, adjectives: ['bright'], nouns: ['watermelons'] }));
    resetWordlistCache();
    const link = await create();
    expect(link.id).toBe('BrightWatermelons');
    expect(link.id).toHaveLength(17);
    expect(isListedId(link.id)).toBe(false);
    expect(await hubStorage.get(env.HUB_DB, `links/${link.id}.json`)).not.toBeNull();
    expect((await request(`/${link.id}`)).status).toBe(200);
    expect((await request(`/${link.id}/preview.jpg`, { method: 'HEAD' })).status).toBe(200);
    expect((await request(`/api/links/${link.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } })).status).toBe(204);
  });

  it('keeps legacy suffixed links readable and deletable, and replays them for private requests', async () => {
    const link = await create();
    const record = await (await hubStorage.get(env.HUB_DB, recordKey(link.id)))!.json<LinkRecord>();
    const legacyId = await deriveLongId(env.HUB_KEY, owner, words);
    await hubStorage.delete(env.HUB_DB, recordKey(link.id));
    await hubStorage.put(env.HUB_DB, recordKey(legacyId), JSON.stringify({ ...record, id: legacyId }));
    expect((await request(`/${legacyId}`)).status).toBe(200);
    expect((await request(`/${legacyId}/preview.jpg`, { method: 'HEAD' })).status).toBe(200);
    expect(await create(input({ access: 'private' }))).toEqual({ id: legacyId, url: `${base}/${legacyId}`,
      shareUrl: `https://colmapview.opsiclear.com/s/${legacyId}`, managementPath: `/hub/manage/${legacyId}` });
    expect((await request(`/api/links/${legacyId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } })).status).toBe(204);
  });

  it('does not overwrite a record when concurrent drafts reuse an ownership key', async () => {
    const responses = await Promise.all(['First', 'Second'].map(title => request('/api/links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input({ title })),
    })));
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect((await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1000 })).objects).toHaveLength(1);
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
  // Nine refusals, each held for REFUSAL_FLOOR_MS, come close to the default five-second timeout.
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
  }, 15_000);

  it('does not let concurrent misses reset the counter or evade the cooldown', async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => request(`/missing-${index}`)));
    expect(responses.filter(response => response.status === 404).length).toBeLessThanOrEqual(2);
    expect(responses.filter(response => response.status === 429).length).toBeGreaterThanOrEqual(10);
    expect(await (await guard()).lookup(null)).toBeGreaterThan(0);
    const state = await runInDurableObject(await guard(), (_, storage) => storage.storage.kv.get<GuardState>('state'));
    expect(state!.blockedUntil).toBeGreaterThan(Date.now());
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
      state.storage.kv.put('state', { misses: {}, blockedUntil: Date.now() - 1,
        creations: { started: Date.now() - 3_600_001, count: 1 } } satisfies GuardState);
    });
    expect((await request(`/${link.id}`)).status).toBe(200);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await runInDurableObject(stub, (_, state) => [...state.storage.kv.list()].length)).toBe(0);
  });

  it('counts malformed IDs uniformly, while static misses and storage failures do not become strikes', async () => {
    const link = await create();
    for (let index = 0; index < 4; index++) expect((await request(`/assets/absent-${index}.js`)).status).toBe(404);
    await hubStorage.put(env.HUB_DB, recordKey(link.id), 'not-json');
    for (let index = 0; index < 4; index++) expect((await request(`/${link.id}`)).status).toBe(503);
    expect(await (await guard()).lookup(null)).toBe(0);
    expect((await request('/%E0%A4%A')).status).toBe(404);
    expect((await request('/malformed')).status).toBe(404);
    expect((await request('/third')).status).toBe(429);
  });

  it('does not count missing fonts or dotted file names as strikes', async () => {
    const link = await create();
    for (let index = 0; index < 4; index++) expect((await request(`/fonts/absent-${index}.woff2`)).status).toBe(404);
    for (let index = 0; index < 4; index++) expect((await request(`/absent-${index}.txt`)).status).toBe(404);
    expect((await request(`/${link.id}`)).status).toBe(200);
    // Strikes are keyed by the first path segment, so the font paths could add only one: two more misses must still pass.
    expect((await request('/first')).status).toBe(404);
    expect((await request('/second')).status).toBe(404);
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
    expect(await hubStorage.get(env.HUB_DB, recordKey(link.id))).toBeNull();
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
    expect((await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1000 })).objects).toHaveLength(0);
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
    expect((await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1000 })).objects).toHaveLength(20);
  });
});
