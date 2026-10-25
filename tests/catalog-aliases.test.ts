import { env } from 'cloudflare:workers';
import { beforeEach, expect, it, vi } from 'vitest';
import { create, input, mockViewerDocument, post, remove, request, resetState } from './helpers';
import { recordKey, resetWordlistCache, WORDLIST_KEY } from '../src/worker/records';

const datasetId = 'data-' + '0'.repeat(24);
const target = 'https://colmapview.opsiclear.com/?url=https://example.org/scene.manifest.json';
const navigation = { 'Sec-Fetch-Dest': 'document' };
beforeEach(async () => {
  await resetState();
  mockViewerDocument();
  await env.LINKS.put(recordKey('HappyTree'), JSON.stringify({ schemaVersion: 1, kind: 'catalog',
    id: 'HappyTree', datasetId, createdAt: '2026-10-25T00:00:00Z' }));
  const source = { id: 'hf-alias-fixture-0123456789ab', sourceId: 'hf:owner/fixture', title: 'Fixture', label: 'Fixture',
    provider: 'huggingface', access: 'public', license: 'cc0', start: 0, count: 1, listingComplete: true };
  const parent = { ...source, sourceUrl: 'https://huggingface.co/datasets/owner/fixture', status: 'verified',
    statusLabel: 'Checked', formats: ['COLMAP'], description: 'Checked scene.', checkedAt: '2026-10-25', testOrFixture: false, facts: [], audits: [] };
  const proof = { level: 'scene_verified', delivery: 'browser_readable', viewerUrl: target, checkedAt: '2026-10-25', summary: 'Checked fixture.',
    scope: 'Fixture model only.', viewerVersion: 'v0.24.2',
    sceneValidation: { status: 'passed', revision: 'revision', cameras: 1, images: 2, points: 3, photoCount: 2,
      export: 'colmap_images', exportSha256: 'a'.repeat(64) } };
  const assets: Record<string, unknown> = {
    'index.json': { schemaVersion: 1, generation: 'alias-test', total: 1, packSize: 2048, sources: [source], facets: {} },
    'ids/00.json': { [datasetId]: 0 }, 'packs/0.json': [[datasetId, 0, 'colmap', 'scene/sparse/0', 'COLMAP', null, null, proof, null, 'HappyTree']],
    [`sources/${source.id}.json`]: parent,
  };
  vi.spyOn(env.CATALOG_ASSETS, 'fetch').mockImplementation(async resource => {
    const path = new URL(resource instanceof Request ? resource.url : String(resource)).pathname;
    const key = path.replace('/hub/datasets/individual/', '');
    return assets[key] ? Response.json(assets[key]) : new Response(null, { status: 404 });
  });
});

it('opens a reserved adjective+noun name directly and keeps the old dataset-code alias working', async () => {
  for (const path of ['/../s/HappyTree', '/../s/happytree', '/HappyTree', '/../s/d/AAAAAAAAAAAAAAAA']) {
    const response = await request(path + '?url=https://unrelated.example', { headers: navigation });
    expect(response.status, path).toBe(200);
    expect(response.headers.get('Location')).toBeNull();
    expect(await response.text()).toContain(JSON.stringify({ version: 1, viewerUrl: target }));
  }
});

it('returns social metadata with the readable copy address and no analytics or deletion controls', async () => {
  const response = await request('/../s/HappyTree');
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain('data-copy-dataset-link="/s/HappyTree"');
  expect(html).toContain('property="og:title"');
  expect(html).not.toMatch(/id="analytics-choice"|id="delete-link"|id="colmapview-hub-launch"/);
  const canonical = await request('/../s/happytree');
  expect(canonical.headers.get('Location')).toBe('https://colmapview.opsiclear.com/s/HappyTree');
});

it('keeps catalog reservations occupied for upload creation and inaccessible to upload delete keys', async () => {
  await env.LINKS.put(WORDLIST_KEY, JSON.stringify({ version: 1, adjectives: ['happy'], nouns: ['tree'] }));
  resetWordlistCache();
  expect((await post(input())).status).toBe(409);
  expect((await remove('HappyTree')).status).toBe(404);
  expect((await request('/../s/HappyTree', { headers: navigation })).status).toBe(200);
});

it('retains lookup cooldowns, including reserved names and both namespaces', async () => {
  for (const name of ['MissingOne', 'MissingTwo']) expect((await request('/../s/' + name)).status).toBe(404);
  expect((await request('/MissingThree')).status).toBe(429);
  expect((await request('/../s/HappyTree', { headers: navigation })).status).toBe(429);
});

it('rejects cross-site embeds before any public or private record read', async () => {
  const reads = vi.spyOn(env.LINKS, 'get');
  expect((await request('/../s/HappyTree', { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'iframe' } })).status).toBe(404);
  expect(reads).not.toHaveBeenCalled();
  expect((await request('/../s/HappyTree', { headers: navigation })).status).toBe(200);
});

it('leaves ordinary uploaded shares on their existing route', async () => {
  const link = await create(input());
  expect(link.id).not.toBe('HappyTree');
  expect((await request('/../s/' + link.id, { headers: navigation })).status).toBe(200);
});

it('does not serve an orphaned or mismatched reservation as another scene’s named link', async () => {
  await env.LINKS.put(recordKey('CalmStone'), JSON.stringify({ schemaVersion: 1, kind: 'catalog',
    id: 'CalmStone', datasetId, createdAt: '2026-10-25T00:00:00Z' }));
  expect((await request('/../s/CalmStone', { headers: navigation })).status).toBe(404);
  expect((await request('/../s/HappyTree', { headers: navigation })).status).toBe(200);
});
