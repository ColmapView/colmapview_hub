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
