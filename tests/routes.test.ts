import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordKey } from '../src/worker/records';
import { base, create, input, request, resetState } from './helpers';

beforeEach(async () => {
  await resetState();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
});
afterEach(() => { vi.restoreAllMocks(); });

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
    const unused = await request('/funnyball');
    const invalid = await request('/zzzzzzzzz');
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
});
