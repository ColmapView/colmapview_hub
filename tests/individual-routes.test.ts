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

it('opens the exact public model without a provider fetch and keeps restricted models on their metadata page', async () => {
  const id = 'data-' + '0'.repeat(24);
  const source = { id: 'hf-owner-data-123456abcdef', sourceId: 'hf:owner/data', title: 'owner/data', label: 'Data',
    provider: 'huggingface', license: 'mit', access: 'public', start: 0, count: 1, listingComplete: true };
  const parent = { ...source, sourceUrl: 'https://huggingface.co/datasets/owner/data', status: 'unverified', statusLabel: 'Files listed',
    formats: ['COLMAP'], description: 'Listed model.', checkedAt: '2026-10-16', testOrFixture: false,
    facts: [{ label: 'Pinned revision', value: 'revision' }], audits: [] };
  const row: unknown[] = [id, 0, 'colmap', 'room/sparse/0', 'COLMAP', null, { cameras: 'room/sparse/0/cameras.bin' }, null];
  const metadata: Record<string, unknown> = {
    'index.json': { schemaVersion: 1, generation: 'test', total: 1, packSize: 2048, checkedAt: '2026-10-16', sources: [source], facets: {},
      kinds: {}, levels: {}, delivery: {}, incompleteCollections: 0, scope: 'Test model.' },
    'ids/00.json': { [id]: 0 }, 'packs/0.json': [row], [`sources/${source.id}.json`]: parent,
  };
  const records = vi.spyOn(env.LINKS, 'get');
  const keys: string[] = [];
  vi.spyOn(env.CATALOG_ASSETS, 'fetch').mockImplementation(async resource => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource));
    expect(url.origin).toBe('https://colmapview.opsiclear.com');
    expect(url.pathname).toMatch(/^\/hub\/datasets\/individual\//);
    const key = url.pathname.slice('/hub/datasets/individual/'.length);
    keys.push(key);
    return metadata[key] ? Response.json(metadata[key]) : new Response(null, { status: 404 });
  });
  const response = await request(`/datasets/open/${id}`);
  expect(response.status).toBe(302);
  const target = new URL(response.headers.get('Location')!);
  expect(target.origin).toBe('https://colmapview.opsiclear.com');
  expect(target.searchParams.get('url')).toBe('https://huggingface.co/datasets/owner/data/tree/revision/room/sparse/0');
  expect(keys).toEqual(['index.json', 'ids/00.json', 'packs/0.json', `sources/${source.id}.json`]);
  source.access = 'gated';
  expect((await request(`/datasets/open/${id}`)).headers.get('Location')).toBe(`/hub/datasets/entry/${id}`);
  expect((await request(`/datasets/open/not-an-id`)).status).toBe(404);
  const write = await request(`/datasets/open/${id}`, { method: 'POST' });
  expect(write.status).toBe(405);
  expect(records).not.toHaveBeenCalled();
});
