import { escapeHtml as escape } from './html';

export const CATALOG_ACCESS_OPTIONS = [
  { value: 'public', label: 'No sign-in required' },
  { value: 'gated', label: 'Approval or sign-in required' },
  { value: 'terms', label: 'Source agreement applies' },
  { value: 'unknown', label: 'Access not established' },
] as const;

export function catalogExtraFilterCount(filters: URLSearchParams): number {
  return ['sort', 'kind', 'provider', 'license', 'status'].filter(field => filters.get(field)).length;
}

const FILTER_LABELS: Record<string, string> = { dataset: 'Collection', licenseCategory: 'License category', sort: 'Feed',
  kind: 'Type', provider: 'Provider', access: 'Access', license: 'License', status: 'Evidence', photos: 'Images',
  data: 'Available data', delivery: 'Delivery', viewer: 'Viewer' };

export function catalogFilterState(filters: URLSearchParams, values: Record<string, string> = {}) {
  const active = Object.entries(FILTER_LABELS).filter(([field]) => filters.get(field));
  const description = active.map(([field, label]) => `${label}: ${values[field] || filters.get(field)}`).join(' · ');
  return { count: active.length, description: active.length ? `More filters (${active.length} active) · ${description}` : 'More filters' };
}

export function emptyCatalogHtml(resetUrl: string): string {
  return '<div class="catalog-empty"><p>No datasets match these filters.</p>'
    + `<a class="button" data-clear-catalog href="${escape(resetUrl)}">Clear search and filters</a></div>`;
}
