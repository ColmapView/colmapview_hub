import { isCatalogSummary, type CatalogSummary } from '../shared/catalog';

export type PreparedCatalogRow = { id: string; json: string };

/** Public, operator-built metadata only. This never reads share records or credentials. */
export async function catalogSummaries(database: D1Database, generation: string, ordinals: number[]): Promise<CatalogSummary[]> {
  if (!ordinals.length) return [];
  const result = await database.prepare(`SELECT ordinal, dataset_id, summary_json FROM catalog_summaries
    WHERE generation = ? AND ordinal IN (${ordinals.map(() => '?').join(',')})`)
    .bind(generation, ...ordinals).all<{ ordinal: number; dataset_id: string; summary_json: string }>();
  if (!result.success || result.results.length !== ordinals.length) throw new Error('Prepared catalog database is incomplete');
  const selected = new Map<number, CatalogSummary>();
  for (const row of result.results) {
    const summary: unknown = JSON.parse(row.summary_json);
    if (!isCatalogSummary(summary) || summary.id !== row.dataset_id || selected.has(row.ordinal)) throw new Error('Invalid prepared catalog row');
    selected.set(row.ordinal, summary);
  }
  return ordinals.map(ordinal => {
    const entry = selected.get(ordinal);
    if (!entry) throw new Error('Prepared catalog database is incomplete');
    return entry;
  });
}

/** Operator/dev seeding; never exposed as an HTTP route. Retain the live generation until rollout. */
export async function synchronizeCatalog(database: D1Database, generation: string, rows: PreparedCatalogRow[], retain: string[]): Promise<{ written: number; unchanged: number }> {
  let written = 0;
  // Read bounded, indexed pages. Comparing actual bytes also repairs interrupted imports or damaged rows;
  // a matching generation name or row count alone does not prove that preparation completed correctly.
  for (let start = 0; start < rows.length; start += 250) {
    const page = rows.slice(start, start + 250);
    const stored = await database.prepare('SELECT ordinal, dataset_id, summary_json FROM catalog_summaries WHERE generation = ? AND ordinal >= ? AND ordinal < ?')
      .bind(generation, start, start + page.length).all<{ ordinal: number; dataset_id: string; summary_json: string }>();
    if (!stored.success) throw new Error('Could not read the catalog database');
    const existing = new Map(stored.results.map(row => [row.ordinal, row]));
    const changed = page.flatMap((row, offset) => {
      const ordinal = start + offset, previous = existing.get(ordinal);
      return previous?.dataset_id === row.id && previous.summary_json === row.json ? [] : [{ ...row, ordinal }];
    });
    for (let offset = 0; offset < changed.length; offset += 50) {
      const results = await database.batch(changed.slice(offset, offset + 50).map(row => database.prepare(
        'INSERT INTO catalog_summaries (generation, ordinal, dataset_id, summary_json) VALUES (?, ?, ?, ?) '
        + 'ON CONFLICT (generation, ordinal) DO UPDATE SET dataset_id = excluded.dataset_id, summary_json = excluded.summary_json '
        + 'WHERE catalog_summaries.dataset_id <> excluded.dataset_id OR catalog_summaries.summary_json <> excluded.summary_json',
      ).bind(generation, row.ordinal, row.id, row.json)));
      if (results.some(result => !result.success)) throw new Error('Could not prepare the catalog database');
      written += results.reduce((sum, result) => sum + result.meta.changes, 0);
    }
  }
  const stored = await database.prepare('SELECT COUNT(*) AS count, MIN(ordinal) AS first, MAX(ordinal) AS last FROM catalog_summaries WHERE generation = ?')
    .bind(generation).first<{ count: number; first: number; last: number }>();
  if (!stored || stored.count !== rows.length || stored.first !== 0 || stored.last !== rows.length - 1) throw new Error('Prepared catalog database is incomplete');
  const generations = [...new Set([generation, ...retain])].sort();
  // Delete disjoint indexed ranges, rather than scanning every retained row with NOT IN.
  for (let index = 0; index <= generations.length; index++) {
    const lower = generations[index - 1], upper = generations[index];
    const conditions = [lower === undefined ? [] : ['generation > ?'], upper === undefined ? [] : ['generation < ?']].flat();
    const result = await database.prepare(`DELETE FROM catalog_summaries WHERE ${conditions.join(' AND ')}`)
      .bind(...[lower, upper].filter(value => value !== undefined)).run();
    if (!result.success) throw new Error('Could not clean up the catalog database');
  }
  return { written, unchanged: rows.length - written };
}
