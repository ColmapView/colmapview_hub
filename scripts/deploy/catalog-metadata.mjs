import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { HUB_ORIGIN, validateFrontendManifest } from '../lib/github-frontend.mjs';
import { preparedCatalog } from '../lib/catalog-metadata.mjs';
import { openHubDatabase, workerModules } from '../lib/hub-database.mjs';
import { readPublic } from './retain-frontend-assets.mjs';

const site = validateFrontendManifest(JSON.parse(await readFile('public/hub/assets/github/site.json', 'utf8')));
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(site.source, git(['rev-parse', 'HEAD']));
assert.equal(git(['status', '--porcelain']), '', 'Commit Hub changes before preparing the public database.');
const catalog = await preparedCatalog();
const current = process.argv.includes('--bootstrap') ? { generation: catalog.index.generation }
  : JSON.parse(await readPublic(`${HUB_ORIGIN}/hub/datasets/api/index`, 256 * 1024, fetch));
assert.match(current.generation, /^[a-f0-9]{64}$/);
const proxy = await openHubDatabase({ remote: true });
try {
  await proxy.database.prepare(await readFile('migrations/0002_catalog_summaries.sql', 'utf8')).run();
  const { synchronizeCatalog } = await workerModules(['catalog-store']);
  await synchronizeCatalog(proxy.database, catalog.index.generation, catalog.rows, [current.generation]);
  console.log(`Prepared ${catalog.rows.length} public summaries; retained the currently live generation.`);
} finally { await proxy.dispose(); }
