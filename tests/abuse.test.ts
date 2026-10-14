import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, guard, input, ip, listings, origin, post, remove, request, resetState } from './helpers';

beforeEach(async () => {
  await resetState();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
});
afterEach(() => { vi.restoreAllMocks(); });

const crossSite = (dest: string) => ({ headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': dest } });
const storedKeys = async (clientIp: string) => runInDurableObject(await guard(clientIp), (_, state) => [...state.storage.kv.list()].length);

describe('cross-site subresources', () => {
  it('answer embedded lookups with 404 before any read or strike', async () => {
    const link = await create(input());
    for (let index = 0; index < 5; index++) expect((await request(`/missing-${index}/preview.jpg`, crossSite('image'), '192.0.2.7')).status).toBe(404);
    expect((await request(`/${link.id}/preview.jpg`, crossSite('image'), '192.0.2.7')).status).toBe(404);
    expect((await request(`/${link.id}`, crossSite('iframe'), '192.0.2.7')).status).toBe(404);
    expect(await storedKeys('192.0.2.7')).toBe(0);
    expect((await request(`/${link.id}`, crossSite('document'), '192.0.2.7')).status).toBe(200);
    expect((await request(`/${link.id}/preview.jpg`, { headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Dest': 'image' } }, '192.0.2.7')).status).toBe(200);
  });

  it('answer embedded sub-path misses the same way, and read no record', async () => {
    const reads = vi.spyOn(env.LINKS, 'get');
    for (const path of ['/one/extra', '/two/extra', '/manage/three/extra', '/HappyTree', '/HappyTree/preview.jpg']) {
      expect((await request(path, crossSite('image'), '192.0.2.7')).status, path).toBe(404);
    }
    expect(reads).not.toHaveBeenCalled();
    expect(await storedKeys('192.0.2.7')).toBe(0);
  });

  it('leave the API alone, because the GitHub Pages viewer calls it cross-site', async () => {
    const response = await request('/api/links', { method: 'POST', headers: { Origin: 'https://colmapview.github.io', 'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Dest': 'empty', 'Content-Type': 'application/json' }, body: JSON.stringify(input()) });
    expect(response.status).toBe(201);
  });
});

describe('verified bots', () => {
  const token = 'verified-bot-token-for-tests';
  const bot = (value: string) => ({ headers: { 'X-Hub-Verified-Bot': value } });

  it('get 30 misses instead of 3 with the Transform Rule token, still per network', async () => {
    for (let index = 1; index < 30; index++) {
      expect((await request(`/miss-${index}`, bot(token), ip, { VERIFIED_BOT_TOKEN: token })).status, String(index)).toBe(404);
    }
    expect((await request('/miss-30', bot(token), ip, { VERIFIED_BOT_TOKEN: token })).status).toBe(429);
    expect((await request('/miss-1', bot(token), '192.0.2.8', { VERIFIED_BOT_TOKEN: token })).status).toBe(404);
  });

  it('get nothing extra without the secret or with a wrong token', async () => {
    for (const [overrides, value] of [[{}, token], [{ VERIFIED_BOT_TOKEN: token }, 'guessed-token']] as const) {
      await resetState();
      await request('/one', bot(value), ip, overrides);
      await request('/two', bot(value), ip, overrides);
      expect((await request('/three', bot(value), ip, overrides)).status).toBe(429);
    }
  });
});

describe('listings flag', () => {
  it('shows the landing page and refuses listings while off', async () => {
    const page = await request('/');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<h1>Share links for ColmapView results.</h1>');
    expect(html).toContain('<a class="button" href="https://colmapview.opsiclear.com/">Open ColmapView</a>');
    expect((await post(input({ listed: true }))).status).toBe(403);
  });

  it('keeps listed links readable and deletable after listings are turned off', async () => {
    const listed = await create(input({ listed: true }), ip, listings);
    expect((await request(`/${listed.id}`)).status).toBe(200);
    expect((await remove(listed.id)).status).toBe(204);
  });

  it('caches the gallery for a minute, refreshing its first page when a listing is created or deleted', async () => {
    const listed = await create(input({ listed: true, title: 'Listed result' }), ip, listings);
    const page = await request('/', {}, ip, listings);
    expect(page.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(await page.text()).toContain(listed.id);
    const cached = await caches.default.match(new Request(`${origin}/hub/`));
    expect(await cached?.text()).toContain(listed.id);
    expect((await remove(listed.id)).status).toBe(204);
    expect(await (await request('/', {}, ip, listings)).text()).not.toContain(listed.id);
    const another = await create(input({ listed: true, title: 'Another result', managementSecret: 'B'.repeat(43) }), ip, listings);
    expect(await (await request('/', {}, ip, listings)).text()).toContain(another.id);
  });
});

describe('loopback origins', () => {
  const local: Partial<Env> = { HUB_ORIGIN: 'http://localhost:5201' };
  const localViewer = `http://localhost:5173/?url=${encodeURIComponent('https://data.example/scene.zip')}`;

  it('are refused on the production Hub', async () => {
    expect((await request('/api/links', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } })).status).toBe(403);
    expect((await request('/api/links', { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify(input()) })).status).toBe(403);
    expect((await post(input({ viewerUrl: localViewer }))).status).toBe(400);
    expect((await request('/missing')).headers.get('Content-Security-Policy')).not.toContain('localhost');
  });

  it('are accepted when the Hub itself runs on loopback', async () => {
    const response = await request('/api/links', { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify(input({ viewerUrl: localViewer })) }, ip, local);
    expect(response.status).toBe(201);
    const { id } = await response.json<{ id: string }>();
    expect((await request(`/${id}`, {}, ip, local)).headers.get('Content-Security-Policy'))
      .toContain('frame-src https://colmapview.opsiclear.com https://colmapview.github.io http://localhost:* http://127.0.0.1:*');
  });
});
