import type { IndividualIndex, IndividualSource } from './individual-catalog';

export const FEED_MODES = ['discover', 'random', 'new'] as const;
export type FeedMode = typeof FEED_MODES[number];
/** Model evidence tier, preview availability, UTC day first catalogued (0 = unknown). */
export type DiscoveryRow = [tier: number, preview: number, firstSeen: number];
export interface DiscoveryAsset { schemaVersion: 1; generation: string; rows: DiscoveryRow[] }
export interface FeedSelection { mode: FeedMode; seed: string }
export const defaultFeedSeed = () => new Date().toISOString().slice(0, 10).replaceAll('-', '');
export const feedMode = (value: string | null): FeedMode => FEED_MODES.find(mode => mode === value) || 'discover';

export function isDiscoveryAsset(value: unknown, index: IndividualIndex): value is DiscoveryAsset {
  if (!value || typeof value !== 'object') return false;
  const asset = value as DiscoveryAsset;
  return asset.schemaVersion === 1 && asset.generation === index.generation && Array.isArray(asset.rows)
    && asset.rows.length === index.total && asset.rows.every(row => Array.isArray(row) && row.length === 3
      && Number.isInteger(row[0]) && row[0] >= 1 && row[0] <= 3 && (row[1] === 0 || row[1] === 1)
      && Number.isSafeInteger(row[2]) && row[2] >= 0 && row[2] <= 100000);
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ value >>> 16) >>> 0;
}

/** Rank only already-qualified ordinals. No provider requests or private records.
 * All lanes share one used set, so an arbitrarily paginated prefix never repeats.
 * Collection balancing is applied after scoring and relaxes when filters leave
 * few collections. Model-only scenes retain their model verification tier. */
export function discoveryOrder(asset: DiscoveryAsset, sources: IndividualSource[], candidates: readonly number[],
  selection: FeedSelection, limit = candidates.length): number[] {
  const salt = selection.seed + ':' + asset.generation;
  const random = new Uint32Array(asset.rows.length);
  for (const ordinal of candidates) random[ordinal] = hash(`${salt}:${ordinal}`);
  const compare = (mode: FeedMode) => (a: number, b: number) => {
    const left = asset.rows[a], right = asset.rows[b];
    return (mode === 'new' ? right[2] - left[2] : 0)
      || (mode !== 'random' ? right[0] - left[0] || right[1] - left[1] : 0)
      || random[a] - random[b] || a - b;
  };
  const groups = new Map<string, number[]>();
  let sourcePosition = 0;
  for (const ordinal of candidates) {
    while (sourcePosition < sources.length && ordinal >= sources[sourcePosition].start + sources[sourcePosition].count) sourcePosition++;
    const source = sources[sourcePosition];
    if (!source || ordinal < source.start) continue;
    const key = source.provider === 'public' ? `public:${source.label}` : source.id;
    const group = groups.get(key) || [];
    group.push(ordinal);
    groups.set(key, group);
  }
  const queues = [...groups].map(([key, ordinals]) => ({ key,
    lanes: Object.fromEntries(FEED_MODES.map(mode => [mode, { values: [...ordinals].sort(compare(mode)), position: 0 }])) as Record<FeedMode, { values: number[]; position: number }>,
    shown: 0, random: hash(`${salt}:collection:${key}`) }));
  const used = new Set<number>(), result: number[] = [], recent: string[] = [];
  const counts = new Map<string, number>();
  // Six ranked, three collection-balanced random, one newly catalogued per ten.
  const mix: FeedMode[] = ['discover', 'random', 'discover', 'discover', 'random', 'discover', 'discover', 'random', 'new', 'discover'];
  const comparisons = { discover: compare('discover'), random: compare('random'), new: compare('new') };
  while (result.length < Math.min(limit, candidates.length)) {
    const lane = selection.mode === 'discover' ? mix[result.length % mix.length] : selection.mode;
    let chosen: typeof queues[number] | undefined;
    let ordinal = -1, penalty = Infinity, day = -1;
    // Scan collection heads once, rather than sorting every remaining scene or
    // allocating/sorting a candidate object list on every feed position.
    for (const group of queues) {
      const queue = group.lanes[lane];
      while (queue.position < queue.values.length && used.has(queue.values[queue.position])) queue.position++;
      if (queue.position >= queue.values.length) continue;
      const next = queue.values[queue.position];
      const nextPenalty = ((counts.get(group.key) || 0) >= 2 ? 2 : 0) + (group.key === recent.at(-1) ? 1 : 0);
      const nextDay = selection.mode === 'new' ? asset.rows[next][2] : 0;
      const comparison = day - nextDay || nextPenalty - penalty || (!chosen ? -1 : lane === 'random'
        ? group.shown - chosen.shown || group.random - chosen.random || group.key.localeCompare(chosen.key, 'en')
        : comparisons[lane](next, ordinal));
      if (!chosen || comparison < 0) { chosen = group; ordinal = next; penalty = nextPenalty; day = nextDay; }
    }
    if (!chosen) break;
    const group = chosen;
    used.add(ordinal);
    result.push(ordinal);
    group.shown++;
    recent.push(group.key);
    counts.set(group.key, (counts.get(group.key) || 0) + 1);
    if (recent.length > 20) {
      const removed = recent.shift()!;
      counts.set(removed, counts.get(removed)! - 1);
    }
  }
  return result;
}
