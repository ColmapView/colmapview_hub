import { isCatalogSummary } from '../shared/catalog';
import type { IndividualPage } from '../shared/individual-catalog';

export interface FeedMemory {
  key: string; query: string; data: IndividualPage; lastPage: number;
  collectionText: string; anchor: { id: string; top: number } | null;
}
const STORAGE = 'colmapview-scene-feed-v1';

function memories(): FeedMemory[] {
  try {
    const raw = sessionStorage.getItem(STORAGE);
    if (!raw || raw.length > 1500000) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values.filter((value): value is FeedMemory => value && typeof value.key === 'string' && typeof value.query === 'string'
      && typeof value.collectionText === 'string' && value.data && Array.isArray(value.data.entries)
      && value.data.entries.length <= 240 && value.data.entries.every(isCatalogSummary)
      && new Set(value.data.entries.map((entry: { id: string }) => entry.id)).size === value.data.entries.length
      && typeof value.data.generation === 'string'
      && [value.data.page, value.data.pages, value.data.total, value.lastPage].every(Number.isSafeInteger)
      && value.data.page > 0 && value.lastPage >= value.data.page && value.lastPage <= value.data.pages && value.data.total >= value.data.entries.length
      && value.data.entries.length === Math.min((value.lastPage - value.data.page + 1) * 24, value.data.total - (value.data.page - 1) * 24)
      && (!value.anchor || typeof value.anchor.id === 'string' && Number.isFinite(value.anchor.top)));
  } catch { return []; }
}

export function recallFeed(key: string, generation: string): FeedMemory | undefined {
  return memories().find(value => value.key === key && value.data.generation === generation);
}

/** A small per-tab return-navigation cache. It contains only public summaries,
 * never scene bytes, credentials, user identifiers or private share records. */
export function rememberFeed(value: FeedMemory): void {
  try {
    const values = [value, ...memories().filter(old => old.key !== value.key)].slice(0, 3);
    while (values.length > 1 && JSON.stringify(values).length > 1000000) values.pop();
    const raw = JSON.stringify(values);
    if (raw.length <= 1000000) sessionStorage.setItem(STORAGE, raw);
  } catch { /* Storage can be disabled or full; browsing remains available. */ }
}
