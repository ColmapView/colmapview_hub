import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';

/** Operator access uses Wrangler's credentials; no database endpoint or token is exposed to clients. */
export async function openHubDatabase({ remote = false, state = '.wrangler/state' } = {}) {
  const source = await readFile('wrangler.jsonc', 'utf8');
  const account = source.match(/"account_id"\s*:\s*"([a-f0-9]{32})"/)?.[1];
  const database = source.match(/"database_id"\s*:\s*"([a-f0-9-]{36})"/)?.[1];
  if (!account || !database) throw new Error('Hub account or database ID unavailable.');
  await mkdir('.tmp/hub-database', { recursive: true });
  const scratch = await mkdtemp(resolve('.tmp/hub-database/run-'));
  const configPath = resolve(scratch, 'wrangler.json');
  await writeFile(configPath, JSON.stringify({ name: 'colmapview-hub-operator', account_id: account,
    compatibility_date: '2026-10-25', d1_databases: [{ binding: 'HUB_DB', database_name: 'colmapview-hub', database_id: database, remote }] }));
  const proxy = await getPlatformProxy({ configPath, persist: remote ? false : { path: resolve(state, 'v3') },
    remoteBindings: remote, envFiles: [] });
  return { database: proxy.env.HUB_DB, dispose: () => proxy.dispose() };
}

export function applyLocalMigrations(state) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply',
    'colmapview-hub', '--local', '--persist-to', state], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Local database migration failed.');
}

export async function workerModules(names = ['storage']) {
  const bundle = await build({ entryPoints: names.map(name => `src/worker/${name}.ts`), bundle: true, write: false,
    outdir: '.tmp/hub-database/modules', format: 'esm', platform: 'node', target: 'node24' });
  return Object.assign({}, ...await Promise.all(bundle.outputFiles.map(file =>
    import('data:text/javascript;base64,' + Buffer.from(file.contents).toString('base64')))));
}
