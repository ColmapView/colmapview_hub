import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';
import { catalogSummaries, synchronizeCatalog } from '../src/worker/catalog-store';
import type { CatalogSummary } from '../src/shared/catalog';

const summary = (ordinal: number): CatalogSummary => ({ id: `data-${ordinal.toString(16).padStart(24, '0')}`,
  title: `Public scene ${ordinal}`, description: 'Public catalog metadata', provider: 'public', license: 'cc0',
  access: 'public', statusLabel: 'Checked', formats: ['COLMAP'], testOrFixture: false });
const rows = Array.from({ length: 7 }, (_, ordinal) => ({ id: summary(ordinal).id, json: JSON.stringify(summary(ordinal)) }));

it('returns a page in requested order using only public catalog rows and fails on a missing generation', async () => {
  await synchronizeCatalog(env.HUB_DB, 'generation-a', rows, []);
  expect(await catalogSummaries(env.HUB_DB, 'generation-a', [6, 0, 3])).toEqual([summary(6), summary(0), summary(3)]);
  await expect(catalogSummaries(env.HUB_DB, 'generation-b', [0])).rejects.toThrow('incomplete');
  expect(await catalogSummaries(env.HUB_DB, 'generation-a', [])).toEqual([]);
});

it('retries seeding idempotently, retains the live generation and leaves share records outside cleanup', async () => {
  await env.HUB_DB.prepare("INSERT INTO hub_entries(namespace,id,body_json,source_bytes) VALUES('links','user-link','{}',2)").run();
  await synchronizeCatalog(env.HUB_DB, 'a', rows, []);
  await synchronizeCatalog(env.HUB_DB, 'a', rows, []);
  await synchronizeCatalog(env.HUB_DB, 'b', rows, ['a']);
  expect((await catalogSummaries(env.HUB_DB, 'a', [0]))[0]).toEqual(summary(0));
  await synchronizeCatalog(env.HUB_DB, 'c', rows, ['b']);
  await expect(catalogSummaries(env.HUB_DB, 'a', [0])).rejects.toThrow('incomplete');
  expect((await catalogSummaries(env.HUB_DB, 'b', [0]))[0]).toEqual(summary(0));
  expect(await env.HUB_DB.prepare("SELECT id FROM hub_entries WHERE id='user-link'").first()).toEqual({ id: 'user-link' });
});

it('rejects corrupt or mismatched stored summaries before publishing a page', async () => {
  await synchronizeCatalog(env.HUB_DB, 'a', rows, []);
  await env.HUB_DB.prepare('UPDATE catalog_summaries SET summary_json=? WHERE generation=? AND ordinal=0').bind(JSON.stringify(summary(2)), 'a').run();
  await expect(catalogSummaries(env.HUB_DB, 'a', [0])).rejects.toThrow('Invalid prepared catalog row');
});


it('writes no unchanged summaries and repairs only missing or damaged rows', async () => {
  const many = Array.from({ length: 513 }, (_, ordinal) => ({ id: summary(ordinal).id, json: JSON.stringify(summary(ordinal)) }));
  expect(await synchronizeCatalog(env.HUB_DB, 'repair', many, [])).toEqual({ written: 513, unchanged: 0 });
  expect(await synchronizeCatalog(env.HUB_DB, 'repair', many, [])).toEqual({ written: 0, unchanged: 513 });
  await env.HUB_DB.prepare('DELETE FROM catalog_summaries WHERE generation=? AND ordinal IN (0,250,512)').bind('repair').run();
  await env.HUB_DB.prepare('UPDATE catalog_summaries SET summary_json=? WHERE generation=? AND ordinal=251').bind('{}', 'repair').run();
  expect(await synchronizeCatalog(env.HUB_DB, 'repair', many, [])).toEqual({ written: 4, unchanged: 509 });
  expect(await catalogSummaries(env.HUB_DB, 'repair', [512, 251, 250, 0])).toEqual([summary(512), summary(251), summary(250), summary(0)]);
});

it('cleans generations on either side and between retained generations even when every summary is unchanged', async () => {
  for (const generation of ['a', 'b', 'c', 'd', 'e']) await synchronizeCatalog(env.HUB_DB, generation, rows, ['a', 'b', 'c', 'd', 'e']);
  expect(await synchronizeCatalog(env.HUB_DB, 'b', rows, ['d', 'b'])).toEqual({ written: 0, unchanged: rows.length });
  const remaining = await env.HUB_DB.prepare('SELECT DISTINCT generation FROM catalog_summaries ORDER BY generation').all<{ generation: string }>();
  expect(remaining.results).toEqual([{ generation: 'b' }, { generation: 'd' }]);
});
