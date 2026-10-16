export interface CatalogFact { label: string; value: string; url?: string }
export interface CatalogAudit { sourceId: string; sourceUrl?: string; checkedAt: string; scope: 'source' | 'collection'; facts: CatalogFact[] }
export interface CatalogEntry {
  id: string;
  sourceId: string;
  provider: 'huggingface' | 'public';
  title: string;
  sourceUrl: string;
  dataUrl?: string;
  viewerUrl?: string;
  license: string;
  access: 'public' | 'gated' | 'terms' | 'unknown';
  status: string;
  statusLabel: string;
  formats: string[];
  description: string;
  checkedAt: string;
  testOrFixture: boolean;
  facts: CatalogFact[];
  audits: CatalogAudit[];
}
export interface CatalogSnapshot {
  schemaVersion: 1;
  sources: { kind: string; name: string; checkedAt: string; sha256: string; rowCount: number }[];
  entries: CatalogEntry[];
  importSummary: { hfCandidates: number; hfEntries: number; publicEntries: number; additionalAuditEntries: number; auditRows: number; linkedAuditRows: number; unlinkedAuditSourceIds: string[] };
}
export type CatalogSummary = Pick<CatalogEntry, 'id' | 'title' | 'provider' | 'license' | 'access' | 'statusLabel' | 'formats' | 'description' | 'testOrFixture'>;
export const CATALOG_PAGE_SIZE = 24;
export const datasetPath = (entry: Pick<CatalogEntry, 'id'>) => `/hub/datasets/${entry.id}`;
export const providerLabel = (provider: CatalogEntry['provider']) => provider === 'huggingface' ? 'Hugging Face' : 'Public source';
export const accessLabel = (access: CatalogEntry['access']) => ({ public: 'Public source', gated: 'Access approval or sign-in required', terms: 'Source agreement applies', unknown: 'Access not established' })[access];

export function catalogSummary(entry: CatalogEntry): CatalogSummary {
  const { id, title, provider, license, access, statusLabel, formats, description, testOrFixture } = entry;
  return { id, title, provider, license, access, statusLabel, formats, description, testOrFixture };
}

export function filterCatalog(entries: CatalogSummary[], filters: { query: string; provider: string; license: string; status: string }): CatalogSummary[] {
  const words = filters.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(entry => (!filters.provider || entry.provider === filters.provider) && (!filters.license || entry.license === filters.license)
    && (!filters.status || entry.statusLabel === filters.status)
    && words.every(word => [entry.title, entry.description, entry.license, ...entry.formats].join(' ').toLocaleLowerCase().includes(word)));
}

export function isCatalogSummary(value: unknown): value is CatalogSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && /^[a-z0-9-]{1,80}-[a-f0-9]{12}$/.test(item.id)
    && ['title', 'license', 'statusLabel', 'description'].every(key => typeof item[key] === 'string')
    && (item.provider === 'huggingface' || item.provider === 'public')
    && ['public', 'gated', 'terms', 'unknown'].includes(String(item.access))
    && typeof item.testOrFixture === 'boolean' && Array.isArray(item.formats) && item.formats.every(format => typeof format === 'string');
}
