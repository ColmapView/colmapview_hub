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
    // A later model-only enumeration cannot upgrade the older media scan.
    const scanLabels = new Map([
      ['Image files listed in repository', 'Image files listed at source scan'],
      ['Archives listed', 'Archives listed at source scan'],
      ['Other splat files listed', 'Other splat files listed at source scan'],
    ]);
    for (const fact of entry.facts) if (scanLabels.has(fact.label)) fact.label = scanLabels.get(fact.label);
    update('Individual model or scene entries listed', source.count);
    update('Individual listing scope', source.scope || 'Public source file listing; archive contents may be incomplete.');
    update('Individual listing coverage', source.listingComplete ? 'Model paths enumerated. Uninspected archives may contain additional models.' : 'Incomplete source listing; additional models may exist.');
    if (Number.isSafeInteger(source.looseColmapCount)) update('Complete COLMAP models listed', source.looseColmapCount);
    if (Number.isSafeInteger(source.plyFileCount)) update('PLY files listed', source.plyFileCount);
  }
  snapshot.individualSummary = individualListingSummary(snapshot.entries, registry);
  return snapshot;
}

/** Count only sources in this snapshot, including when publication excludes a source. */
export function individualListingSummary(entries, registry) {
  const ids = new Map(entries.map(entry => [entry.sourceId, entry.id]));
  const active = registry.sources.filter(source => ids.get(source.sourceId) === source.datasetId);
  const registered = new Set(active.map(source => source.sourceId));
  const publicScenes = entries.filter(entry => entry.provider === 'public' && !registered.has(entry.sourceId)
    && entry.facts.some(fact => fact.label === 'Collection')).length;
  return { checkedAt: registry.checkedAt, entries: active.reduce((sum, source) => sum + source.count, 0) + publicScenes,
    sourceEntriesWithModels: active.filter(source => source.count).length + publicScenes,
    incompleteCollections: active.filter(source => !source.listingComplete).length };
}
