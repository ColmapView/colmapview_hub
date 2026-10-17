import { licenseCategory } from './license-categories';
import type { LicenseCategory } from './license-categories';
import { isPhotoStatus } from './scene-photos';
import type { PhotoStatus, ScenePhotoAudit } from './scene-photos';
export { classifyLicense, licenseCategory, LICENSE_CATEGORIES, LICENSE_CATEGORY_LABELS, LICENSE_CATEGORY_NOTE } from './license-categories';

export interface CatalogFact { label: string; value: string; url?: string }
export interface CatalogAudit { sourceId: string; sourceUrl?: string; checkedAt: string; scope: 'source' | 'collection'; facts: CatalogFact[] }
export interface CatalogVerification {
  level: string;
  delivery: string;
  checkedAt: string;
  summary: string;
  scope: string;
  viewerVersion: string;
  sourceImages?: { status: 'not_included'; summary: string; sourceUrl: string };
  photoAvailability?: PhotoStatus;
  photoAudit?: ScenePhotoAudit;
  opening?: { status: 'access_required' | 'extraction_required' | 'load_failed'; summary: string };
}
export interface CatalogEntry {
  id: string;
  sourceId: string;
  provider: 'huggingface' | 'public';
  title: string;
  sourceUrl: string;
  dataUrl?: string;
  viewerUrl?: string;
  license: string;
  licenseCategory?: LicenseCategory;
  access: 'public' | 'gated' | 'terms' | 'unknown';
  status: string;
  statusLabel: string;
  formats: string[];
  description: string;
  checkedAt: string;
  testOrFixture: boolean;
  facts: CatalogFact[];
  audits: CatalogAudit[];
  verification?: CatalogVerification;
  modelManifest?: { version: 1; baseUrl: string; files: { cameras: string; images: string; points3D: string }; imagesPath?: string };
  dataset?: { id: string; label: string; title: string };
  itemKind?: string;
  candidateViewerUrl?: string;
  openUrl?: string;
  datasetLabel?: string;
  photoStatus?: PhotoStatus;
}
export interface CatalogSnapshot {
  schemaVersion: 1;
  sources: { kind: string; name: string; checkedAt: string; sha256: string; rowCount: number }[];
  entries: CatalogEntry[];
  importSummary: { hfCandidates: number; hfEntries: number; publicEntries: number; additionalAuditEntries: number; auditRows: number; linkedAuditRows: number; unlinkedAuditSourceIds: string[] };
  auditSummary?: { checkedAt: string; sourcesAudited: number; levels: Record<string, number>; delivery: Record<string, number>;
    evidenceRefresh?: { checkedAt: string; browserUrls: number; accessChecks: number; directSamples: number; directPassed: number; directFailed: number; modelFileChecks: number; extractedMembers: number } };
  individualSummary?: { checkedAt: string; entries: number; sourceEntriesWithModels: number; incompleteCollections: number };
  assetInventorySummary?: { checkedAt: string; entries: number; sourceEntriesWithModels: number; incompleteCollections: number };
  sceneSummary?: { checkedAt: string; entries: number; sourceEntriesWithModels: number; incompleteCollections: number };
  photoAudit?: { checkedAt: string; scenes: number; photos: Partial<Record<PhotoStatus, number>> };
}
export type CatalogSummary = Pick<CatalogEntry, 'id' | 'title' | 'provider' | 'license' | 'licenseCategory' | 'access' | 'statusLabel' | 'formats' | 'description' | 'testOrFixture' | 'dataset' | 'itemKind' | 'photoStatus'> & { delivery?: string; hasViewer?: boolean; openUrl?: string };
export const CATALOG_PAGE_SIZE = 24;
export const datasetPath = (entry: Pick<CatalogEntry, 'id'>) => `/hub/datasets/${entry.id.startsWith('data-') ? 'entry/' : ''}${entry.id}`;
export function isCatalogOpenUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^\/hub\/datasets\/open\/data-[a-f0-9]{24}$/.test(value)) return true;
  try {
    const url = new URL(value);
    return ['https://colmapview.opsiclear.com', 'https://colmapview.github.io'].includes(url.origin)
      && !url.username && !url.password && url.pathname === '/' && url.searchParams.has('url');
  } catch { return false; }
}
export const catalogOpenUrl = (entry: CatalogSummary) => isCatalogOpenUrl(entry.openUrl) ? entry.openUrl : datasetPath(entry);
export const datasetLabel = (entry: CatalogEntry) => entry.dataset?.label || entry.datasetLabel || entry.facts.find(fact => fact.label === 'Collection')?.value || entry.title.split('/').at(-1) || entry.title;
export const datasetFilterValue = (entry: Pick<CatalogSummary, 'dataset' | 'provider'>) => entry.dataset
  ? entry.provider === 'public' ? `public:${entry.dataset.label}` : entry.dataset.id : '';
export const providerLabel = (provider: CatalogEntry['provider']) => provider === 'huggingface' ? 'Hugging Face' : 'Public source';
export const accessLabel = (access: CatalogEntry['access']) => ({ public: 'Public source', gated: 'Access approval or sign-in required', terms: 'Source agreement applies', unknown: 'Access not established' })[access];
const deliveryLabels: Record<string, string> = { browser_readable: 'Browser read checked', cors_headers_checked: 'Model access and CORS headers checked', server_readable: 'Server read checked',
  gated: 'Approval or sign-in required', access_denied: 'Download access denied', not_found: 'Download not found',
  browser_request_failed: 'Browser request failed', range_unverified: 'Archive ranges unverified', rate_limited: 'Host rate limited',
  http_error: 'Download error', unverified: 'Delivery unverified', not_tested: 'Browser read not checked' };
export const deliveryLabel = (delivery?: string) => deliveryLabels[delivery || 'not_tested'] || 'Delivery unverified';

export function catalogSummary(entry: CatalogEntry): CatalogSummary {
  const { id, title, provider, license, access, statusLabel, formats, description, testOrFixture, dataset, itemKind } = entry;
  const canOpen = access === 'public' && !entry.verification?.opening
    && !['gated', 'access_denied', 'not_found', 'browser_request_failed', 'range_unverified', 'rate_limited', 'http_error'].includes(entry.verification?.delivery || '')
    && !['conversion_needed', 'no_native_assets', 'unavailable'].includes(entry.verification?.level || '');
  return { id, title, provider, license, licenseCategory: licenseCategory(entry), access, statusLabel, formats, description, testOrFixture,
    ...(canOpen && isCatalogOpenUrl(entry.openUrl || entry.viewerUrl) ? { openUrl: entry.openUrl || entry.viewerUrl } : {}),
    dataset: dataset || { id, label: datasetLabel(entry), title }, ...(itemKind ? { itemKind } : {}),
    ...(entry.photoStatus ? { photoStatus: entry.photoStatus } : {}),
    ...(entry.verification ? { delivery: entry.verification.delivery, hasViewer: Boolean(entry.viewerUrl) && canOpen } : {}) };
}

export function filterCatalog(entries: CatalogSummary[], filters: { query: string; provider: string; license: string; licenseCategory?: string; status: string; delivery?: string; viewer?: string }): CatalogSummary[] {
  const words = filters.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return entries.filter(entry => (!filters.provider || entry.provider === filters.provider) && (!filters.license || entry.license === filters.license)
    && (!filters.licenseCategory || licenseCategory(entry) === filters.licenseCategory)
    && (!filters.status || entry.statusLabel === filters.status)
    && (!filters.delivery || entry.delivery === filters.delivery) && (filters.viewer !== 'available' || entry.hasViewer === true)
    && words.every(word => [entry.title, entry.dataset?.label || '', entry.dataset?.title || '', entry.itemKind || '', entry.description, entry.license, ...entry.formats].join(' ').toLocaleLowerCase().includes(word)));
}

export function isCatalogSummary(value: unknown): value is CatalogSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const dataset = item.dataset as Record<string, unknown> | undefined;
  return typeof item.id === 'string' && /^(?:[a-z0-9-]{1,80}-[a-f0-9]{12}|data-[a-f0-9]{24})$/.test(item.id)
    && ['title', 'license', 'statusLabel', 'description'].every(key => typeof item[key] === 'string')
    && (item.licenseCategory === undefined || ['commercial', 'non-commercial', 'not-specified'].includes(String(item.licenseCategory)))
    && (item.provider === 'huggingface' || item.provider === 'public')
    && ['public', 'gated', 'terms', 'unknown'].includes(String(item.access))
    && (item.delivery === undefined || typeof item.delivery === 'string') && (item.hasViewer === undefined || typeof item.hasViewer === 'boolean')
    && (item.openUrl === undefined || isCatalogOpenUrl(item.openUrl))
    && (item.itemKind === undefined || typeof item.itemKind === 'string')
    && (item.photoStatus === undefined || isPhotoStatus(item.photoStatus))
    && (dataset === undefined || Boolean(dataset && typeof dataset === 'object' && typeof dataset.id === 'string' && /^[a-z0-9-]{1,80}-[a-f0-9]{12}$/.test(dataset.id)
      && typeof dataset.label === 'string' && typeof dataset.title === 'string'))
    && typeof item.testOrFixture === 'boolean' && Array.isArray(item.formats) && item.formats.every(format => typeof format === 'string');
}
