import { individualListingSummary } from './individual-listings.mjs';

/** Keep in sync with is_access_restricted in build_individual_catalog.py.
 * Both consumers run the same publication-policy fixtures. */
export function isAccessRestricted(entry) {
  return entry.access === 'gated' || Boolean(entry.gated) || entry.delivery === 'gated'
    || entry.verification?.delivery === 'gated' || entry.verification?.opening?.status === 'access_required';
}

/** Research inputs remain complete. Only this projection is published. */
export function publicationSnapshot(catalog, audit, registry, scenes) {
  const excluded = new Set([...catalog.entries, ...audit.results].filter(isAccessRestricted).map(entry => entry.sourceId));
  const entries = catalog.entries.filter(entry => !excluded.has(entry.sourceId));
  const results = audit.results.filter(entry => !excluded.has(entry.sourceId));
  const counts = key => results.reduce((totals, row) => {
    const value = row[key] || 'not_tested';
    totals[value] = (totals[value] || 0) + 1;
    return totals;
  }, {});
  const browserUrls = new Set(results.flatMap(row => (row.browserChecks || []).map(check => check.url))).size;
  const imports = results.filter(row => row.viewerImport);
  const evidenceRefresh = audit.evidenceRefresh ? { ...audit.evidenceRefresh,
    scope: 'Counts cover retained public audit records. Each source and import receipt keeps its original check date; publication filtering performs no new source checks.',
    browserUrls, accessChecks: results.reduce((sum, row) => sum + (row.accessChecks?.length || 0), 0),
    directSamples: imports.length, directPassed: imports.filter(row => row.viewerImport.status === 'passed').length,
    directFailed: imports.filter(row => row.viewerImport.status === 'failed').length,
    modelFileChecks: results.filter(row => row.modelFileImport).length,
    extractedMembers: results.filter(row => row.extractedMemberImport).length } : undefined;
  const publishedAudit = { ...audit, results,
    scope: `${audit.scope} Access-restricted sources are excluded from this public download.`,
    ...(audit.browserCoverage ? { browserCoverage: { completed: browserUrls, total: browserUrls } } : {}),
    ...(evidenceRefresh ? { evidenceRefresh } : {}) };
  const base = { ...catalog };
  delete base.individualSummary;
  const snapshot = { ...base, entries,
    importSummary: { ...catalog.importSummary,
      hfEntries: entries.filter(entry => entry.provider === 'huggingface').length,
      publicEntries: entries.filter(entry => entry.provider === 'public' && !entry.sourceId.startsWith('audit:')).length,
      additionalAuditEntries: entries.filter(entry => entry.sourceId.startsWith('audit:')).length },
    ...(catalog.auditSummary ? { auditSummary: { ...catalog.auditSummary,
      sourcesAudited: results.length, levels: counts('level'), delivery: counts('delivery'),
      ...(evidenceRefresh ? { evidenceRefresh } : {}) } } : {}),
    assetInventorySummary: individualListingSummary(entries, registry),
    ...(scenes ? { sceneSummary: { checkedAt: scenes.checkedAt, entries: scenes.total,
      sourceEntriesWithModels: scenes.sources.filter(source => source.count).length,
      incompleteCollections: scenes.incompleteCollections } } : {}) };
  return { snapshot, audit: publishedAudit };
}
