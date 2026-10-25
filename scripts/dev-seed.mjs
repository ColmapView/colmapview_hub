import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { getPlatformProxy } from 'wrangler';
import { validateNames } from './catalog/share-names.mjs';

/** Seed only local R2, using the same storage layout as Wrangler's --persist-to. */
export async function seedLocalHub(state) {
  await mkdir(state, { recursive: true });
  const configPath = `${state}/seed.json`;
  await writeFile(configPath, JSON.stringify({ name: 'colmapview-local-seed', compatibility_date: '2026-10-12',
    r2_buckets: [{ binding: 'LINKS', bucket_name: 'colmapview-hub', remote: false }] }));
  const proxy = await getPlatformProxy({ configPath, persist: { path: `${state}/v3` }, remoteBindings: false, envFiles: [] });
  try {
    const bucket = proxy.env.LINKS;
    await bucket.put('internal/wordlists-v1.json', await readFile('tests/fixtures/dev-wordlists.json', 'utf8'));
    const names = validateNames(JSON.parse(await readFile('data/catalog-share-names.json', 'utf8')));
    const entries = Object.entries(names);
    for (let start = 0; start < entries.length; start += 32) {
      await Promise.all(entries.slice(start, start + 32).map(async ([datasetId, id]) => {
        const key = `links/${id}.json`;
        const value = { schemaVersion: 1, kind: 'catalog', id, datasetId, createdAt: '2026-10-25T00:00:00Z' };
        if (await bucket.put(key, JSON.stringify(value), { onlyIf: { etagDoesNotMatch: '*' } })) return;
        const stored = await bucket.get(key);
        const current = stored && await stored.json();
        if (current?.kind !== 'catalog' || current.datasetId !== datasetId) throw new Error('Local share collides with a catalog name; choose fresh local state');
      }));
    }
    console.log(`Seeded ${entries.length} public catalog names in local R2.`);
  } finally { await proxy.dispose(); }
}
