import { env } from 'cloudflare:workers';
import { beforeEach, expect, it, vi } from 'vitest';
import { request, resetState } from './helpers';

beforeEach(resetState);

it('keeps public catalog misses separate from private share-link lookups and their cooldown', async () => {
  const records = vi.spyOn(env.LINKS, 'get');
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await request('/datasets/entry/not-a-valid-model-id');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Dataset entry not found.');
  }
  expect(records).not.toHaveBeenCalled();
  expect((await request('/first-private-miss')).status).toBe(404);
  expect((await request('/second-private-miss')).status).toBe(404);
  expect((await request('/third-private-miss')).status).toBe(429);
});

it('validates bounded public searches before any catalog or private-record read', async () => {
  const records = vi.spyOn(env.LINKS, 'get');
  const assets = vi.spyOn(env.CATALOG_ASSETS, 'fetch');
  const response = await request('/datasets/api/entries?q=one+two+three+four+five+six+seven');
  expect(response.status).toBe(400);
  expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
  expect(await response.json()).toEqual({ error: 'Use up to six search words.' });
  expect(records).not.toHaveBeenCalled();
  expect(assets).not.toHaveBeenCalled();
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});

it('does not expose catalog writes and preserves HEAD and document security headers', async () => {
  const response = await request('/datasets/api/entries', { method: 'POST' });
  expect(response.status).toBe(405);
  expect(response.headers.get('Allow')).toBe('GET, HEAD');
  expect(response.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
  const missing = await request('/datasets/entry/not-a-model', { method: 'HEAD' });
  expect(missing.status).toBe(404);
  expect(await missing.text()).toBe('');
});
