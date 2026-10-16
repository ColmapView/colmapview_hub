/** Merge a pinned individual listing without promoting its paths to load proof. */
export function applyIndividualListings(snapshot, registry) {
  if (registry.schemaVersion !== 1 || !Array.isArray(registry.sources)) throw new Error('Invalid individual dataset inventory');
  const bySource = new Map(registry.sources.map(source => [source.sourceId, source]));
  if (bySource.size !== registry.sources.length) throw new Error('Duplicate individual dataset source');
  for (const entry of snapshot.entries) {
    const source = bySource.get(entry.sourceId);
    if (!source) continue;
    if (source.datasetId !== entry.id || (entry.provider === 'huggingface' && source.revision !== entry.facts.find(fact => fact.label === 'Pinned revision')?.value)) {
      throw new Error(`Individual listing revision changed; refresh ${entry.sourceId}`);
    }
    const update = (label, value) => {
      entry.facts = entry.facts.filter(fact => fact.label !== label);
      entry.facts.push({ label, value: String(value) });
    };
    update('Individual model or scene entries listed', source.count);
    update('Individual listing scope', source.scope || 'Public source file listing; archive contents may be incomplete.');
    update('Individual listing coverage', source.listingComplete ? 'Model paths enumerated. Uninspected archives may contain additional models.' : 'Incomplete source listing; additional models may exist.');
    if (Number.isSafeInteger(source.looseColmapCount)) update('Complete COLMAP models listed', source.looseColmapCount);
    if (Number.isSafeInteger(source.plyFileCount)) update('PLY files listed', source.plyFileCount);
  }
  const publicScenes = snapshot.entries.filter(entry => entry.provider === 'public' && !bySource.has(entry.sourceId)
    && entry.facts.some(fact => fact.label === 'Collection')).length;
  snapshot.individualSummary = { checkedAt: registry.checkedAt, entries: registry.individualEntries + publicScenes,
    sourceEntriesWithModels: registry.sources.filter(source => source.count).length + publicScenes,
    incompleteCollections: registry.sources.filter(source => !source.listingComplete).length };
  return snapshot;
}
