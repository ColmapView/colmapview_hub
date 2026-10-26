import { mkdir, readFile } from 'node:fs/promises';
import { validateNames } from './catalog/share-names.mjs';
import { applyLocalMigrations, openHubDatabase, workerModules } from './lib/hub-database.mjs';

/** Seed only local D1, using the same storage layout as Wrangler's --persist-to. */
export async function seedLocalHub(state) {
  await mkdir(state, { recursive: true });
  applyLocalMigrations(state);
  const proxy = await openHubDatabase({ state });
  try {
    const { hubStorage, entryInsert, WORDLIST_KEY } = await workerModules();
    const database = proxy.database;
    await hubStorage.put(database, WORDLIST_KEY, await readFile('tests/fixtures/dev-wordlists.json', 'utf8'));
    const names = validateNames(JSON.parse(await readFile('data/catalog-share-names.json', 'utf8')));
    const entries = Object.entries(names);
    for (let start = 0; start < entries.length; start += 50) {
      const batch = entries.slice(start, start + 50);
      const results = await database.batch(batch.map(([datasetId, id]) => entryInsert(database, `links/${id}.json`,
        JSON.stringify({ schemaVersion: 1, kind: 'catalog', id, datasetId, createdAt: '2026-10-25T00:00:00Z' }), { createOnly: true })));
      await Promise.all(batch.map(async ([datasetId, id], index) => {
        if (results[index].meta.changes) return;
        const key = `links/${id}.json`;
        const stored = await hubStorage.get(database, key);
        const current = stored && await stored.json();
        if (current?.kind !== 'catalog' || current.datasetId !== datasetId) throw new Error('Local share collides with a catalog name; choose fresh local state');
      }));
    }
    console.log(`Seeded ${entries.length} public catalog names in local D1.`);
  } finally { await proxy.dispose(); }
}
