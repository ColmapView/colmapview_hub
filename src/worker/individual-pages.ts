import { LICENSE_CATEGORIES, LICENSE_CATEGORY_LABELS, LICENSE_CATEGORY_NOTE } from '../shared/license-categories';
import { INDIVIDUAL_PAGE_SIZE, individualDatasetOptions, individualSelection, savedFilterSummary } from '../shared/individual-catalog';
import type { IndividualIndex, IndividualPage } from '../shared/individual-catalog';
import { photoLabel } from '../shared/scene-photos';
import type { PhotoStatus } from '../shared/scene-photos';
import { catalogCard } from './catalog-pages';
import { escapeHtml as escape, intro, page } from './pages';
import type { HubLocation } from './pages';
import { HUB_UI_VERSION } from '../shared/ui-version';

const number = (value: number) => value.toLocaleString('en-US');
export function individualBrowseUrl(filters: URLSearchParams, pageNumber = 1): string {
  const query = new URLSearchParams(filters);
  if (pageNumber > 1) query.set('page', String(pageNumber)); else query.delete('page');
  return '/hub/datasets/' + (query.size ? `?${query}` : '');
}

export function individualIndexPage(location: HubLocation, index: IndividualIndex, result: IndividualPage, filters: URLSearchParams): string {
  const options = (values: { value: string; label: string }[], field: string) => values.map(({ value, label }) => `<option value="${escape(value)}"${filters.get(field) === value ? ' selected' : ''}>${escape(label)}</option>`).join('');
  const select = (field: string, title: string, all: string, values: { value: string; label: string }[]) => `<label${field === 'licenseCategory' ? ' class="catalog-license-filter"' : ''}>${title}<select name="${field}" aria-label="${title}"><option value="">${all}</option>${options(values, field)}</select></label>`;
  const values = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b, 'en')).map(value => ({ value, label: value }));
  const dataset = individualSelection(index.sources, filters.get('dataset') || '');
  const offset = (result.page - 1) * INDIVIDUAL_PAGE_SIZE;
  const advanced = ['provider', 'license', 'status', 'photos'].some(field => filters.has(field));
  const savedFilters = savedFilterSummary(filters);
  return page(location, 'Public datasets', '<div class="catalog-index">' + intro('Public datasets', `${number(index.total)} named scene datasets · ${number(index.sources.filter(source => source.count).length)} source collections`)
    + '<p class="catalog-hint">Explore camera and reconstruction datasets. Original photographs are optional; each scene records its photo availability and loading evidence.</p>'
    + `<form id="individual-search" class="catalog-filters" role="search" action="/hub/datasets/" method="get" data-page="${result.page}" data-pages="${result.pages}" data-total="${result.total}" data-generation="${escape(result.generation)}">`
    + `<div class="catalog-primary"><label class="catalog-query"><span class="sr-only">Search datasets</span><input aria-label="Search datasets" type="search" name="q" value="${escape(filters.get('q') || '')}" maxlength="160" placeholder="Search datasets or scenes…"></label>`
    + select('dataset', 'Collection', 'All collections', individualDatasetOptions(index.sources, filters.get('dataset') || ''))
    + select('kind', 'Type', 'All scene types', values(Object.keys(index.kinds)))
    + select('licenseCategory', 'License category', 'All licenses', LICENSE_CATEGORIES.map(value => ({ value, label: LICENSE_CATEGORY_LABELS[value] })))
    + '<button type="submit" class="button button-primary">Search</button><a id="catalog-reset" class="button" href="/hub/datasets/">Reset</a></div>'
    + `<details class="catalog-advanced"${advanced ? ' open' : ''}><summary>More filters</summary><div class="catalog-secondary">`
    + select('provider', 'Source', 'All sources', [{ value: 'huggingface', label: 'Hugging Face' }, { value: 'public', label: 'Public sources' }])
    + select('license', 'License', 'All reported licenses', values(index.sources.map(source => source.license)))
    + select('status', 'Evidence', 'All evidence levels', values(Object.keys(index.levels)))
    + select('photos', 'Photographs', 'All photo availability', [{ value: 'available', label: 'Photos on current paths' },
      ...Object.keys(index.photos || {}).sort().map(value => ({ value, label: photoLabel(value as PhotoStatus) }))])
    + '</div></details>'
    + ['delivery', 'viewer'].map(field => `<input type="hidden" name="${field}" value="${escape(filters.get(field) || '')}">`).join('') + '</form>'
    + `<p id="catalog-saved-filters" class="note"${savedFilters ? '' : ' hidden'}>${escape(savedFilters)}</p>`
    + `<p id="dataset-selection" class="dataset-selection"${dataset ? '' : ' hidden'}>${dataset ? `Collection: <strong>${escape(dataset.label)}</strong> · ${number(dataset.count)} scenes${dataset.listingComplete ? '' : ' · listing incomplete'}.` : ''}</p>`
    + `<p id="catalog-count" class="catalog-count" role="status" tabindex="-1">${result.total ? `Showing ${number(offset + 1)}–${number(offset + result.entries.length)} of ${number(result.total)} ${result.total === 1 ? 'scene dataset' : 'scene datasets'}` : 'No matching datasets'}</p>`
    + '<p id="catalog-status" class="catalog-status" role="status"></p>'
    + `<div id="catalog-results" class="dataset-grid">${result.entries.length ? result.entries.map(catalogCard).join('') : '<p>No datasets match these filters.</p>'}</div>`
    + '<nav class="catalog-pagination" aria-label="Dataset pages">'
    + `<a class="button" id="catalog-prev" href="${escape(individualBrowseUrl(filters, result.page - 1))}"${result.page === 1 ? ' hidden' : ''}>Previous</a>`
    + `<span id="catalog-page">Page ${result.page} of ${number(result.pages)}</span>`
    + '<button type="button" class="button" id="catalog-more" hidden>Load more</button>'
    + `<a class="button" id="catalog-next" href="${escape(individualBrowseUrl(filters, result.page + 1))}"${result.page === result.pages ? ' hidden' : ''}>Next</a></nav>`
    + '<details class="catalog-notes"><summary>About this catalog</summary><div>'
    + '<p>Each card identifies one named scene at a pinned source revision. Native camera/model layouts have bounded format and access checks. Original photographs may be available, partial, absent or unverified. Full loading, complete exports and mask support retain their separate evidence; a layout check does not establish them. Standalone geometry files do not create dataset cards.</p>'
    + `<p>${escape(LICENSE_CATEGORY_NOTE)}</p><p><a href="/hub/datasets/audit">Audit and coverage</a></p>`
    + '<p><a href="/hub/datasets/individual/photo-audit.csv" download>Photo availability, launch manifests and path policies for every scene (CSV)</a> · <a href="/hub/datasets/individual/photo-audit.json" download>Photo audit totals (JSON)</a></p>'
    + '<p><a href="/hub/datasets/individual/component-audit.csv" download>Missing component audit — October 19, 2026 (CSV)</a> · <a href="/hub/datasets/individual/component-audit.json.gz" download>Full evidence (JSON.gz)</a></p>'
    + '<p><a href="/hub/datasets/individual/verified-scenes.json" download>Verified scene checks (JSON)</a> · <a href="/hub/datasets/individual/index.json" download>Labels and coverage (JSON)</a> · <a href="/hub/datasets/catalog.json" download>Source metadata (JSON)</a></p></div></details></div>',
    `<script type="module" src="/hub/assets/individual-catalog.js?v=${HUB_UI_VERSION}"></script>`);
}
