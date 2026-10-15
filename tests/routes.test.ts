import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ID_PATTERN } from '../src/shared/model';
import { recordKey, resetWordlistCache, WORDLIST_KEY } from '../src/worker/records';
import { base, create, input, ip, listings, request, resetState } from './helpers';

beforeEach(resetState);

/** Counts R2 record reads: each call returns the keys read since the previous call. Word-list reads don't count. */
function recordReads(): () => string[] {
  const get = vi.spyOn(env.LINKS, 'get');
  return () => {
    const keys = get.mock.calls.map(([key]) => key).filter(key => key !== WORDLIST_KEY);
    get.mockClear();
    return keys;
  };
}

describe('routes', () => {
  it('redirects a trailing slash with 308 before any lookup', async () => {
    const response = await request('/HappyTree/');
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe(`${base}/HappyTree`);
    expect((await request('/one')).status).toBe(404);
    expect((await request('/two')).status).toBe(404);
  });

  it('resolves a short name typed in another letter case', async () => {
    const link = await create(input());
    const lower = link.id.toLowerCase();
    for (const [path, target] of [
      [`/${lower}`, `${base}/${link.id}`],
      [`/${link.id.toUpperCase()}/preview.jpg`, `${base}/${link.id}/preview.jpg`],
      [`/manage/${lower}`, `${base}/manage/${link.id}`],
    ]) {
      const response = await request(path);
      expect(response.status, path).toBe(308);
      expect(response.headers.get('Location')).toBe(target);
    }
  });

  it('answers unused and invalid word pairs identically, each as one strike', async () => {
    const reads = recordReads();
    const unused = await request('/funnyball');
    expect(reads()).toEqual([recordKey('FunnyBall')]);
    const invalid = await request('/zzzzzzzzz');
    expect(reads()).toEqual([recordKey('zzzzzzzzz')]);
    expect([unused.status, invalid.status]).toEqual([404, 404]);
    expect(await unused.text()).toBe(await invalid.text());
    expect((await request('/third-miss')).status).toBe(429);
  });

  it('keeps long-name suffixes case-sensitive', async () => {
    const link = await create(input({ access: 'private' }));
    const dash = link.id.indexOf('-');
    const [pair, suffix] = [link.id.slice(0, dash), link.id.slice(dash)];
    const redirected = await request(`/${pair.toLowerCase()}${suffix}`);
    expect(redirected.status).toBe(308);
    expect(redirected.headers.get('Location')).toBe(`${base}/${link.id}`);
    const flipped = suffix.replace(/[A-Za-z]/g, letter => letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase());
    expect((await request(`/${pair}${flipped}`)).status).toBe(404);
  });

  it('answers page routes with HTML pages and API routes with JSON', async () => {
    const missing = await request('/missing-page');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await missing.text()).toContain('Check the address, or ask for a new link.');
    const apiMissing = await request('/api/links/MissingTree-AAAAAAAAAAAAAAAA', { method: 'DELETE', headers: { Authorization: `Bearer ${'B'.repeat(43)}` } });
    expect(apiMissing.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(await apiMissing.json()).toEqual({ error: 'Link not found.' });
    const blocked = await request('/missing-three');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('600');
    expect(await blocked.text()).toContain('Try again in 10 minutes');
  });

  it('shows the unavailable page for storage failures and keeps API errors in JSON', async () => {
    const link = await create(input());
    await env.LINKS.put(recordKey(link.id), 'not-json');
    const page = await request(`/${link.id}`);
    expect(page.status).toBe(503);
    expect(await page.text()).toContain('ColmapView Hub is unavailable');
    const api = await request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    expect(api.status).toBe(400);
    expect(await api.json()).toEqual({ error: 'Link request is not valid JSON.' });
  });

  it('removes the body from every HEAD response', async () => {
    const link = await create(input());
    for (const path of [`/${link.id}`, `/${link.id}/preview.jpg`, '/missing-head']) {
      expect(await (await request(path, { method: 'HEAD' })).text(), path).toBe('');
    }
  });

  it('lets allowed cross-origin callers read Retry-After', async () => {
    await request('/one'); await request('/two'); await request('/three');
    const response = await request('/api/links', { method: 'POST', headers: { Origin: 'https://colmapview.github.io', 'Content-Type': 'application/json' },
      body: JSON.stringify(input()) });
    expect(response.status).toBe(429);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://colmapview.github.io');
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Retry-After');
  });

  it('redirects a misplaced capital with one record read, and counts a misplaced-capital miss', async () => {
    const link = await create(input());
    // Moves the second capital one letter on, for example QuickForest to QuickfOrest.
    const second = link.id.slice(1).search(/[A-Z]/) + 1;
    const misplaced = link.id.slice(0, second) + link.id[second].toLowerCase() + link.id[second + 1].toUpperCase() + link.id.slice(second + 2);
    expect(misplaced).toMatch(ID_PATTERN);
    const reads = recordReads();
    const hit = await request(`/${misplaced}`);
    expect(hit.status).toBe(308);
    expect(hit.headers.get('Location')).toBe(`${base}/${link.id}`);
    expect(reads()).toEqual([recordKey(link.id)]);
    // Like the trailing-slash redirect, it keeps the query string.
    const query = await request(`/${misplaced}?utm_source=chat&x=1`);
    expect(query.status).toBe(308);
    expect(query.headers.get('Location')).toBe(`${base}/${link.id}?utm_source=chat&x=1`);
    expect(reads()).toEqual([recordKey(link.id)]);
    expect((await request('/FunnYball')).status).toBe(404);
    expect(reads()).toEqual([recordKey('FunnyBall')]);
    expect((await request('/second-miss')).status).toBe(404);
    expect((await request('/third-miss')).status).toBe(429);
  });

  it('never reroutes a name whose own split is a valid word pair', async () => {
    await env.LINKS.put(WORDLIST_KEY, JSON.stringify({ version: 1, adjectives: ['quick', 'quickf'], nouns: ['forest', 'orest'] }));
    resetWordlistCache();
    const link = await create(input());
    const record = await (await env.LINKS.get(recordKey(link.id)))!.json<Record<string, unknown>>();
    for (const id of ['QuickForest', 'QuickfOrest']) await env.LINKS.put(recordKey(id), JSON.stringify({ ...record, id, title: `Result ${id}` }));
    for (const id of ['QuickfOrest', 'QuickForest']) {
      const response = await request(`/${id}`);
      expect(response.status, id).toBe(200);
      expect(await response.text(), id).toContain(`Result ${id}`);
    }
  });

  it('reads canonical names as typed while the word lists are unavailable', async () => {
    const link = await create(input());
    await env.LINKS.delete(WORDLIST_KEY);
    resetWordlistCache();
    expect((await request(`/${link.id}`)).status).toBe(200);
    expect((await request(`/${link.id.toLowerCase()}`)).status).toBe(503);
  });

  it('counts letter-case variants of a manage sub-path once, without redirecting', async () => {
    for (const path of ['/manage/QuickForest/x', '/manage/quickforest/x', '/manage/QUICKFOREST/', '/manage/QuickForest/x/y']) {
      expect((await request(path)).status, path).toBe(404);
    }
    expect((await request('/one')).status).toBe(404);
    expect((await request('/two')).status).toBe(429);
  });

  it('sends the shared headers with the 503 for a misconfigured Hub location', async () => {
    const response = await request('/missing', {}, ip, { HUB_PATH: '/Not-Valid' });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'The Hub is temporarily unavailable. Please try again.' });
    for (const [name, value] of [['Cache-Control', 'no-store'], ['X-Content-Type-Options', 'nosniff'],
      ['X-Robots-Tag', 'noindex, nofollow, noarchive'], ['Referrer-Policy', 'no-referrer']]) expect(response.headers.get(name), name).toBe(value);
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('answers an invalid gallery cursor with an HTML 400 page', async () => {
    const response = await request(`/?cursor=${'a'.repeat(2049)}`, {}, ip, listings);
    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toContain('Invalid page cursor.');
  });

  it('drops a trailing slash from the raw path and keeps the query', async () => {
    for (const [path, target] of [['/HappyTree/?from=share', `${base}/HappyTree?from=share`], ['/%E0%A4%A/', `${base}/%E0%A4%A`]]) {
      const response = await request(path);
      expect(response.status, path).toBe(308);
      expect(response.headers.get('Location'), path).toBe(target);
    }
  });
});
