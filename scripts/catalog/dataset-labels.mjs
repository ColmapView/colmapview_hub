export function applyDatasetLabels(snapshot, overrides) {
  if (overrides.schemaVersion !== 1 || !overrides.labels || typeof overrides.labels !== 'object' || Array.isArray(overrides.labels)) throw new Error('Invalid dataset labels');
  const sources = new Set(snapshot.entries.map(entry => entry.sourceId));
  for (const [sourceId, label] of Object.entries(overrides.labels)) {
    if (!sources.has(sourceId) || typeof label !== 'string' || !label.trim() || label.length > 160) throw new Error(`Invalid dataset label: ${sourceId}`);
  }
  for (const entry of snapshot.entries) entry.datasetLabel = overrides.labels[entry.sourceId]
    || entry.facts.find(fact => fact.label === 'Collection')?.value || entry.title.split('/').at(-1) || entry.title;
  return snapshot;
}
