import { webcrypto } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { getPlatformProxy } from 'wrangler';
import { datasetPattern, namePattern, reserveCatalogName, validateNames } from './share-names.mjs';
import { runPython } from '../lib/python.mjs';

// Plan by default. --apply reserves only new public names; --verify reads exact assigned keys.
const flags = process.argv.slice(2);
const randomIndex = length => {
  const bytes = new Uint32Array(1);
  const limit = 0x100000000 - 0x100000000 % length;
  do { webcrypto.getRandomValues(bytes); } while (bytes[0] >= limit);
  return bytes[0] % length;
};
if (flags.some(flag => !['--apply', '--verify'].includes(flag)) || flags.length > 1) throw new Error('Use no flag, --apply, or --verify');
const apply = flags.includes('--apply'), verify = flags.includes('--verify');
// Refresh qualified IDs offline, including new scenes that do not have names yet.
runPython(['-m', 'scripts.catalog.build_individual_catalog']);
const filename = 'data/catalog-share-names.json';
const journal = '.tmp/catalog-share-name-allocations.ndjson';
const json = async path => JSON.parse(await readFile(path, 'utf8'));
let names;
try { names = validateNames(await json(filename)); }
catch (error) { if (error.code !== 'ENOENT') throw error; names = {}; }
const index = await json('public/hub/datasets/individual/index.json');
const ids = [];
for (let start = 0; start < index.total; start += index.packSize) {
  for (const row of await json(`public/hub/datasets/individual/packs/${Math.floor(start / index.packSize)}.json`)) {
    if (!datasetPattern.test(row[0])) throw new Error('Invalid public scene ID');
    ids.push(row[0]);
  }
}
if (ids.length !== index.total || new Set(ids).size !== ids.length) throw new Error('Catalog identity mismatch');
const missing = ids.filter(id => !names[id]);
console.log(JSON.stringify({ scenes: ids.length, assigned: ids.length - missing.length, missing: missing.length, mode: apply ? 'apply' : verify ? 'verify' : 'plan' }));
if (!apply && !verify) process.exit(0);
if (verify && missing.length) throw new Error('Assign missing catalog names before verification');

await mkdir('.tmp', { recursive: true });
const temporary = await mkdtemp('.tmp/catalog-share-proxy-');
const source = await readFile('wrangler.jsonc', 'utf8');
const account = source.match(/"account_id"\s*:\s*"([a-f0-9]{32})"/)?.[1];
if (!account) throw new Error('Hub account ID unavailable');
const configPath = `${temporary}/wrangler.jsonc`;
await writeFile(configPath, JSON.stringify({ name: 'colmapview-catalog-aliases', account_id: account,
  compatibility_date: '2026-10-25', r2_buckets: [{ binding: 'LINKS', bucket_name: 'colmapview-hub', remote: true }] }));
const proxy = await getPlatformProxy({ configPath, persist: false, envFiles: [], remoteBindings: true });
const bucket = proxy.env.LINKS;
const save = async () => {
  validateNames({ schemaVersion: 1, names });
  await writeFile(filename + '.tmp', JSON.stringify({ schemaVersion: 1, names: Object.fromEntries(Object.entries(names).sort()) }, null, 2) + '\n');
  await rename(filename + '.tmp', filename);
};
const check = async (id, name) => {
  if (!datasetPattern.test(id) || typeof name !== 'string' || !namePattern.test(name)) throw new Error('Invalid reserved catalog name');
  const stored = await bucket.get(`links/${name}.json`);
  const value = stored && stored.size < 1024 ? await stored.json() : null;
  if (value?.kind !== 'catalog' || value.schemaVersion !== 1 || value.id !== name || value.datasetId !== id) throw new Error('Reserved catalog name does not match its dataset');
};
try {
  if (apply) {
    // Recover only this allocator's journal. No bucket listing or unlisted-link enumeration.
    try {
      for (const line of (await readFile(journal, 'utf8')).trim().split('\n').filter(Boolean)) {
        const { id, name } = JSON.parse(line);
        if (ids.includes(id) && !names[id]) { await check(id, name); names[id] = name; }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const bundle = await build({ entryPoints: ['src/worker/records.ts', 'src/worker/ids.ts'], bundle: true, write: false,
      outdir: temporary, format: 'esm', platform: 'node' });
    const modules = await Promise.all(bundle.outputFiles.map(file => import('data:text/javascript;base64,' + Buffer.from(file.contents).toString('base64'))));
    const { readWordlists, lookupTarget } = Object.assign({}, ...modules);
    // Private naming lists remain in process memory; only selected public names are saved.
    const words = await readWordlists(bucket);
    const used = new Set(Object.values(names).map(name => name.toLowerCase()));
    const nextName = async () => {
      for (;;) {
        const adjective = words.adjectives[randomIndex(words.adjectives.length)], noun = words.nouns[randomIndex(words.nouns.length)];
        const name = adjective[0].toUpperCase() + adjective.slice(1) + noun[0].toUpperCase() + noun.slice(1);
        if (used.has(name.toLowerCase()) || !namePattern.test(name)) continue;
        const canonical = await lookupTarget(name.toLowerCase(), async () => words);
        if (canonical?.key !== name || used.has(name.toLowerCase())) continue;
        used.add(name.toLowerCase());
        return name;
      }
    };
    const pending = ids.filter(id => !names[id]);
    for (let start = 0; start < pending.length; start += 16) {
      const results = await Promise.allSettled(pending.slice(start, start + 16).map(async id => {
        const name = await reserveCatalogName(bucket, id, nextName);
        await appendFile(journal, JSON.stringify({ id, name }) + '\n');
        names[id] = name;
      }));
      await save();
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      if (start % 256 === 0) console.log(JSON.stringify({ assigned: Math.min(start + 16, pending.length), newNames: pending.length }));
    }
    await save();
  }
  for (let start = 0; start < ids.length; start += 16) {
    await Promise.all(ids.slice(start, start + 16).map(id => check(id, names[id])));
  }
  console.log(JSON.stringify({ verified: ids.length, uniqueNames: new Set(ids.map(id => names[id])).size }));
} finally { await proxy.dispose(); }
