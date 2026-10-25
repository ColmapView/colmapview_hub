import { LICENSE_CATEGORIES, LICENSE_CATEGORY_LABELS } from '../shared/license-categories';
import { INDIVIDUAL_PAGE_SIZE, individualDatasetOptions, individualSelection, savedFilterSummary } from '../shared/individual-catalog';
import type { IndividualIndex, IndividualPage } from '../shared/individual-catalog';
import { photoLabel } from '../shared/scene-photos';
import type { PhotoStatus } from '../shared/scene-photos';
import { catalogCard } from './catalog-pages';
import { escapeHtml as escape, page } from './pages';
import type { HubLocation } from './pages';
import { HUB_UI_VERSION } from '../shared/ui-version';
import { SCENE_DATA_LABELS } from '../shared/scene-contents';
import { icon } from '../shared/icons';

const number = (value: number) => value.toLocaleString('en-US');
export function individualBrowseUrl(filters: URLSearchParams, pageNumber = 1): string {
  const query = new URLSearchParams(filters);
  if (pageNumber > 1) query.set('page', String(pageNumber)); else query.delete('page');
  return '/hub/datasets/' + (query.size ? `?${query}` : '');
}

export function individualIndexPage(location: HubLocation, index: IndividualIndex, result: IndividualPage, filters: URLSearchParams): string {
  const options = (values: { value: string; label: string }[], field: string) => values.map(({ value, label }) => `<option value="${escape(value)}"${filters.get(field) === value ? ' selected' : ''}>${escape(label)}</option>`).join('');
  const select = (field: string, title: string, all: string, values: { value: string; label: string }[], compact = false) => `<label class="catalog-field catalog-field-${field}"><span${compact ? ' class="sr-only"' : ''}>${title}</span><select name="${field}" aria-label="${title}"><option value="">${all}</option>${options(values, field)}</select></label>`;
  const values = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b, 'en')).map(value => ({ value, label: value }));
  const dataset = individualSelection(index.sources, filters.get('dataset') || '');
  const offset = (result.page - 1) * INDIVIDUAL_PAGE_SIZE;
  const advanced = ['dataset', 'licenseCategory', 'sort', 'kind', 'provider', 'license', 'status', 'photos', 'data', 'delivery', 'viewer'].some(field => filters.has(field));
  const savedFilters = savedFilterSummary(filters);
  const shuffle = new URLSearchParams(filters);
  shuffle.set('seed', [...crypto.getRandomValues(new Uint8Array(8))].map(byte => byte.toString(16).padStart(2, '0')).join(''));
  shuffle.delete('page');
  const filterForm = `<form id="individual-search" class="catalog-filters" role="search" action="/hub/datasets/" method="get" data-page="${result.page}" data-pages="${result.pages}" data-total="${result.total}" data-generation="${escape(result.generation)}">`
    + `<div class="catalog-primary"><label class="catalog-query"><span class="sr-only">Search datasets</span><input aria-label="Search datasets" type="search" name="q" value="${escape(filters.get('q') || '')}" maxlength="160" placeholder="Search datasets or scenes…"></label>`
    + select('dataset', 'Collection', 'All collections', individualDatasetOptions(index.sources, filters.get('dataset') || ''), true)
    + `<button type="submit" class="button button-primary icon-button" aria-label="Search" title="Search">${icon('search')}</button>`
    + `<details class="catalog-advanced"${advanced ? ' data-active' : ''}><summary class="button icon-button" title="More filters"><span class="sr-only">More filters</span>${icon('filters')}</summary><div class="catalog-secondary">`
    + select('licenseCategory', 'License category', 'All licenses', LICENSE_CATEGORIES.map(value => ({ value, label: LICENSE_CATEGORY_LABELS[value] })))
    + select('sort', 'Feed', 'Discover', [{ value: 'random', label: 'Random' }, { value: 'new', label: 'New to Hub' }])
    + select('kind', 'Type', 'All scene types', values(Object.keys(index.kinds)))
    + select('provider', 'Source', 'All sources', [{ value: 'huggingface', label: 'Hugging Face' }, { value: 'public', label: 'Public sources' }])
    + select('license', 'License', 'All reported licenses', values(index.sources.map(source => source.license)))
    + select('status', 'Evidence', 'All evidence levels', values(Object.keys(index.levels)))
    + select('data', 'Available data', 'Any data', Object.entries(SCENE_DATA_LABELS).filter(([key]) => index.contents?.[key]).map(([value, label]) => ({ value, label })))
    + select('photos', 'Images', 'All image availability', [{ value: 'available', label: 'Images on current paths' },
      ...Object.keys(index.photos || {}).sort().map(value => ({ value, label: photoLabel(value as PhotoStatus) }))])
    + '</div></details></div>'
    + ['delivery', 'viewer', 'seed'].map(field => `<input type="hidden" name="${field}" value="${escape(filters.get(field) || '')}">`).join('') + '</form>';
  const notes = '<details class="catalog-notes"><summary class="button icon-button" title="About this catalog"><span class="sr-only">About this catalog</span>' + icon('info') + '</summary><div>'
    + `<p class="catalog-totals">${number(index.total)} scene entries · ${number(index.sources.filter(source => source.count).length)} sources</p>`
    + `<p id="catalog-saved-filters" class="note"${savedFilters ? '' : ' hidden'}>${escape(savedFilters)}</p>`
    + `<p id="dataset-selection" class="dataset-selection"${dataset ? '' : ' hidden'}>${dataset ? `Collection: <strong>${escape(dataset.label)}</strong> · ${number(dataset.count)} scenes${dataset.listingComplete ? '' : ' · listing incomplete'}.` : ''}</p>`
    + '<p>Explore camera and reconstruction datasets, with photos or video where available.</p></div></details>';
  const countDescription = result.total ? `Showing ${number(offset + 1)}–${number(offset + result.entries.length)} of ${number(result.total)} ${result.total === 1 ? 'scene dataset' : 'scene datasets'}` : 'No matching datasets';
  const status = `<div class="catalog-result-summary"><p id="catalog-count" class="catalog-count" role="status" tabindex="-1" aria-label="${countDescription}" title="${countDescription}">${result.total ? `${number(offset + 1)}–${number(offset + result.entries.length)} / ${number(result.total)}` : 'No matching datasets'}</p>`
    + '<p id="catalog-status" class="catalog-status" role="status"></p></div>'
    + `<a id="catalog-shuffle" class="button icon-button" href="${escape(individualBrowseUrl(shuffle))}" aria-label="Shuffle" title="Shuffle">${icon('shuffle')}</a>`
    + `<a id="catalog-reset" class="button icon-button" href="/hub/datasets/" aria-label="Reset" title="Reset filters">${icon('reset')}</a>` + notes;
  return page(location, 'Public datasets', '<div class="catalog-index"><h1 class="sr-only">Public datasets</h1>'
    + '<section id="shared-datasets" class="shared-datasets" aria-label="Shared on Hub" hidden><h2>Shared on Hub</h2>'
    + '<p role="status">Loading shared datasets…</p><div class="dataset-grid" aria-label="Shared datasets"></div>'
    + '<button type="button" class="button" data-shared-more hidden>Load more shared datasets</button></section>'
    + `<div id="catalog-results" class="dataset-grid dataset-feed" aria-label="Scene feed">${result.entries.length ? result.entries.map(catalogCard).join('') : '<p>No datasets match these filters.</p>'}</div>`
    + '<div id="catalog-sentinel" aria-hidden="true"></div>'
    + `<p id="catalog-end" class="catalog-end"${result.page === result.pages && result.total ? '' : ' hidden'}>You’ve reached the end of these scenes. <a id="catalog-reshuffle" href="${escape(individualBrowseUrl(shuffle))}">Shuffle again</a></p>`
    + '<nav class="catalog-pagination" aria-label="Dataset pages">'
    + `<a class="button" id="catalog-prev" href="${escape(individualBrowseUrl(filters, result.page - 1))}"${result.page === 1 ? ' hidden' : ''}>Previous</a>`
    + `<span id="catalog-page" class="sr-only">Page ${result.page} of ${number(result.pages)}</span>`
    + '<button type="button" class="button" id="catalog-more" hidden>Load more</button>'
    + `<a class="button" id="catalog-next" href="${escape(individualBrowseUrl(filters, result.page + 1))}"${result.page === result.pages ? ' hidden' : ''}>Next</a></nav>`
    + '</div>',
    `<script id="catalog-initial-data" type="application/json">${JSON.stringify(result).replaceAll('<', '\\u003c')}</script><script type="module" src="/hub/assets/individual-catalog.js?v=${HUB_UI_VERSION}"></script>`, true,
    { filters: filterForm, status });
}
