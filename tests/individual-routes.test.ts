import { env } from 'cloudflare:workers';
import { beforeEach, expect, it, vi } from 'vitest';
import { base, request, resetState } from './helpers';
import { HUB_UI_VERSION } from '../src/shared/ui-version';

beforeEach(resetState);

it('redirects retired browse pages without reading metadata or private records', async () => {
  const records = vi.spyOn(env.LINKS, 'get');
  const assets = vi.spyOn(env.CATALOG_ASSETS, 'fetch');
  for (const path of ['', '/', '/datasets/collections', '/datasets/collections.html', '/datasets/collections/',
    '/datasets/collection-page-2', '/datasets/collection-page-2.html', '/datasets/page-3/']) {
    const response = await request(`${path}?q=room&licenseCategory=commercial&page=4`, { method: 'HEAD' });
    expect(response.status, path).toBe(path === '' || path === '/' ? 307 : 308);
    const target = new URL(response.headers.get('Location')!);
    expect(target.pathname).toBe('/hub/datasets/');
    expect(target.searchParams.get('q')).toBe('room');
    expect(target.searchParams.get('licenseCategory')).toBe('commercial');
    expect(target.searchParams.get('page')).toBe(path === '' || path === '/' ? '4' : null);
    expect(await response.text()).toBe('');
  }
  expect(assets).not.toHaveBeenCalled();
  expect(records).not.toHaveBeenCalled();
});

it('redirects only current collection identities and preserves their scene filters', async () => {
  const id = 'hf-kept-source-0123456789ab';
  const removed = 'public-removed-source-0123456789ab';
  const records = vi.spyOn(env.LINKS, 'get');
  const assets = vi.spyOn(env.CATALOG_ASSETS, 'fetch').mockImplementation(async () => Response.json({
    schemaVersion: 1, generation: 'a'.repeat(64), total: 1, packSize: 2048, sources: [{ id, count: 1 }, { id: removed, count: 0 }],
  }));
  for (const suffix of ['', '/', '.html']) {
    const response = await request(`/datasets/${id}${suffix}?q=room&dataset=another&page=5`);
    expect(response.status).toBe(308);
    const target = new URL(response.headers.get('Location')!);
    expect(target.pathname).toBe('/hub/datasets/');
    expect(target.searchParams.get('dataset')).toBe(id);
    expect(target.searchParams.get('q')).toBe('room');
    expect(target.searchParams.has('page')).toBe(false);
  }
  expect((await request(`/datasets/${removed}`)).status).toBe(404);
  expect((await request('/datasets/hf-absent-source-0123456789ab')).status).toBe(404);
  expect((await request(`/datasets/${id}`, { method: 'POST' })).status).toBe(405);
  expect(assets).toHaveBeenCalledTimes(5);
  expect(records).not.toHaveBeenCalled();
});

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

it('does not serve a removed model from a legacy or previous-generation cache', async () => {
  const path = `/datasets/entry/data-${'c'.repeat(24)}`;
  const cached = new Response('Removed gated model', { headers: { 'Cache-Control': 'public, max-age=300', ETag: '"old-model"' } });
  const legacyKey = new Request(base + path);
  const oldKey = new Request(`${base}${path}?_catalog=${'a'.repeat(64)}`);
  const oldUiKey = new Request(`${base}${path}?_catalog=${'b'.repeat(64)}`);
  await caches.default.put(legacyKey, cached.clone());
  await caches.default.put(oldKey, cached.clone());
  await caches.default.put(oldUiKey, cached);
  const assets = { fetch: vi.fn(async (input: Request) => input.url.endsWith('/index.json')
    ? Response.json({ schemaVersion: 1, generation: 'b'.repeat(64), total: 1, packSize: 2048, sources: [] })
    : new Response(null, { status: 404 })) } as unknown as Fetcher;
  try {
    const response = await request(path, { headers: { 'If-None-Match': '"old-model"' } }, undefined, { CATALOG_ASSETS: assets });
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).not.toContain('Removed gated model');
    expect(assets.fetch).toHaveBeenCalledTimes(2);
  } finally {
    await caches.default.delete(legacyKey);
    await caches.default.delete(oldKey);
    await caches.default.delete(oldUiKey);
  }
});

it('invalidates cached search results when the published inventory changes', async () => {
  let generation = 'd'.repeat(64);
  const source = { id: 'hf-kept-source-0123456789ab', sourceId: 'hf:owner/kept', title: 'Kept', label: 'Kept', provider: 'huggingface',
    access: 'public', license: 'cc0', start: 0, count: 1, listingComplete: true };
  const assets = { fetch: vi.fn(async (input: Request) => input.url.endsWith('/index.json')
    ? Response.json({ schemaVersion: 1, generation, total: 1, packSize: 2048, sources: [source] })
    : Response.json([[`data-${'d'.repeat(24)}`, 0, 'ply', `${generation[0]}.ply`, 'PLY', null, null, null]])) } as unknown as Fetcher;
  const keys = ['d', 'e'].map(char => new Request(`${base}/datasets/api/entries?_catalog=${char.repeat(64)}&_ui=${HUB_UI_VERSION}`));
  try {
    const first = await request('/datasets/api/entries', {}, undefined, { CATALOG_ASSETS: assets });
    const firstEtag = first.headers.get('ETag')!;
    expect(first.headers.get('Cache-Control')).toBe('public, no-cache, must-revalidate, no-transform');
    expect(first.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
    const internal = await caches.default.match(keys[0]);
    expect(internal?.headers.get('Cache-Control')).toBe('public, max-age=300, no-transform');
    expect(internal?.headers.has('Cloudflare-CDN-Cache-Control')).toBe(false);
    expect((await first.json<{ entries: { title: string }[] }>()).entries[0].title).toBe('d.ply');
    const same = await request('/datasets/api/entries', { headers: { 'If-None-Match': firstEtag } }, undefined, { CATALOG_ASSETS: assets });
    expect(same.status).toBe(304);
    expect(same.headers.get('Cache-Control')).toBe('public, no-cache, must-revalidate, no-transform');
    expect(same.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
    expect(assets.fetch).toHaveBeenCalledTimes(3); // index on every request; pack only on the first
    generation = 'e'.repeat(64);
    const changed = await request('/datasets/api/entries', { headers: { 'If-None-Match': firstEtag } }, undefined, { CATALOG_ASSETS: assets });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('ETag')).not.toBe(firstEtag);
    expect((await changed.json<{ entries: { title: string }[] }>()).entries[0].title).toBe('e.ply');
    expect(assets.fetch).toHaveBeenCalledTimes(5);
  } finally {
    for (const key of keys) await caches.default.delete(key);
  }
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
  const unchecked = await request(`/datasets/open/${id}`);
  expect(unchecked.headers.get('Location')).toBe(`/hub/datasets/entry/${id}`);
  keys.length = 0;
  const viewerUrl = 'https://colmapview.opsiclear.com/?url=' + encodeURIComponent('https://huggingface.co/datasets/owner/data/resolve/revision/room/sparse/0');
  row[7] = { level: 'scene_verified', delivery: 'browser_readable', viewerUrl,
    sceneValidation: { status: 'passed', revision: 'revision', cameras: 1, images: 2, points: 3, photoCount: 2,
      export: 'colmap_images', exportSha256: 'a'.repeat(64) } };
  const response = await request(`/datasets/open/${id}`);
  expect(response.status).toBe(302);
  const target = new URL(response.headers.get('Location')!);
  expect(target.origin).toBe('https://colmapview.opsiclear.com');
  expect(target.searchParams.get('url')).toBe('https://huggingface.co/datasets/owner/data/resolve/revision/room/sparse/0');
  expect(keys).toEqual(['index.json', 'ids/00.json', 'packs/0.json', `sources/${source.id}.json`]);
  source.access = 'gated';
  expect((await request(`/datasets/open/${id}`)).headers.get('Location')).toBe(`/hub/datasets/entry/${id}`);
  source.access = 'public';
  row[5] = 'scene.zip';
  row[7] = { level: 'header_checked', delivery: 'browser_readable', viewerUrl: target.href };
  expect((await request(`/datasets/open/${id}`)).headers.get('Location')).toBe(`/hub/datasets/entry/${id}`);
  row[5] = null;
  row[7] = { level: 'header_checked', delivery: 'rate_limited', viewerUrl: target.href };
  expect((await request(`/datasets/open/${id}`)).headers.get('Location')).toBe(`/hub/datasets/entry/${id}`);
  row[7] = { level: 'header_checked', delivery: 'browser_readable', viewerUrl: target.href, opening: { status: 'load_failed', summary: 'Failed import.' } };
  expect((await request(`/datasets/open/${id}`)).headers.get('Location')).toBe(`/hub/datasets/entry/${id}`);
  expect((await request(`/datasets/open/not-an-id`)).status).toBe(404);
  const write = await request(`/datasets/open/${id}`, { method: 'POST' });
  expect(write.status).toBe(405);
  expect(records).not.toHaveBeenCalled();
});
