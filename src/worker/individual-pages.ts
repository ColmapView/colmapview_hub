import { deliveryLabel } from '../shared/catalog';
import { INDIVIDUAL_PAGE_SIZE, individualDatasetOptions, individualSelection } from '../shared/individual-catalog';
import type { IndividualIndex, IndividualPage } from '../shared/individual-catalog';
import { catalogCard } from './catalog-pages';
import { escapeHtml as escape, intro, page } from './pages';
import type { HubLocation } from './pages';

const number = (value: number) => value.toLocaleString('en-US');
export function individualBrowseUrl(filters: URLSearchParams, pageNumber = 1): string {
  const query = new URLSearchParams(filters);
  if (pageNumber > 1) query.set('page', String(pageNumber)); else query.delete('page');
  return '/hub/datasets/' + (query.size ? `?${query}` : '');
}

export function individualIndexPage(location: HubLocation, index: IndividualIndex, result: IndividualPage, filters: URLSearchParams): string {
  const options = (values: { value: string; label: string }[], field: string) => values.map(({ value, label }) => `<option value="${escape(value)}"${filters.get(field) === value ? ' selected' : ''}>${escape(label)}</option>`).join('');
  const select = (field: string, title: string, all: string, values: { value: string; label: string }[]) => `<label>${title}<select name="${field}" aria-label="${title}"><option value="">${all}</option>${options(values, field)}</select></label>`;
  const values = (items: string[]) => [...new Set(items)].sort((a, b) => a.localeCompare(b, 'en')).map(value => ({ value, label: value }));
  const dataset = individualSelection(index.sources, filters.get('dataset') || '');
  const offset = (result.page - 1) * INDIVIDUAL_PAGE_SIZE;
  const description = `${number(index.total)} individual models and scenes from ${number(index.sources.filter(source => source.count).length)} source entries.`;
  return page(location, 'Public datasets', '<div class="catalog-index">' + intro('Public datasets', description)
    + '<p class="note">Each entry identifies one model or scene. Dataset labels group related entries; files that make up a COLMAP reconstruction stay together.</p>'
    + '<p class="note">Counts cover listed models. Uninspected archives and incomplete source listings may contain more. <a href="/hub/datasets/collections">Browse dataset collections</a> · <a href="/hub/datasets/audit">Read the audit</a>.</p>'
    + `<p id="dataset-selection" class="dataset-selection"${dataset ? '' : ' hidden'}>${dataset ? `Dataset: <strong>${escape(dataset.label)}</strong> · ${escape(dataset.title)} · ${number(dataset.count)} entries${dataset.listingComplete ? '' : ' · source listing incomplete'}. <a href="${escape(dataset.metadataUrl)}">Collection metadata</a>.` : ''}</p>`
    + `<form id="individual-search" class="catalog-filters" role="search" action="/hub/datasets/" method="get">`
    + `<label class="catalog-query">Search datasets<input type="search" name="q" value="${escape(filters.get('q') || '')}" maxlength="160" placeholder="Dataset, scene, model or format…"></label>`
    + select('dataset', 'Dataset', 'All datasets', individualDatasetOptions(index.sources, filters.get('dataset') || ''))
    + select('provider', 'Source', 'All sources', [{ value: 'huggingface', label: 'Hugging Face' }, { value: 'public', label: 'Public sources' }])
    + select('kind', 'Type', 'All model types', values(Object.keys(index.kinds)))
    + select('license', 'License', 'All licenses', values(index.sources.map(source => source.license)))
    + select('status', 'Evidence', 'All evidence levels', values(Object.keys(index.levels)))
    + select('delivery', 'Delivery', 'All delivery results', Object.keys(index.delivery).sort().map(value => ({ value, label: deliveryLabel(value) })))
    + select('viewer', 'Viewer link', 'All models', [{ value: 'available', label: 'Checked sample link' }])
    + '<button type="submit" class="button">Search</button><button type="reset" class="button">Reset</button></form>'
    + `<p id="catalog-count" class="catalog-count" role="status" tabindex="-1">${result.total ? `Showing ${number(offset + 1)}–${number(offset + result.entries.length)} of ${number(result.total)} ${result.total === 1 ? 'entry' : 'entries'}` : 'No matching datasets'}</p>`
    + `<div id="catalog-results" class="dataset-grid">${result.entries.length ? result.entries.map(catalogCard).join('') : '<p>No datasets match these filters.</p>'}</div>`
    + '<nav class="catalog-pagination" aria-label="Dataset pages">'
    + `<a class="button" id="catalog-prev" href="${escape(individualBrowseUrl(filters, result.page - 1))}"${result.page === 1 ? ' hidden' : ''}>Previous</a>`
    + `<span id="catalog-page">Page ${result.page} of ${number(result.pages)}</span>`
    + `<a class="button" id="catalog-next" href="${escape(individualBrowseUrl(filters, result.page + 1))}"${result.page === result.pages ? ' hidden' : ''}>Next</a></nav>`
    + '<p class="note catalog-download"><a href="/hub/datasets/individual/index.json" download>Download collection labels and coverage (JSON)</a> · <a href="/hub/datasets/catalog.json" download>Source metadata (JSON)</a></p></div>',
    '<script type="module" src="/hub/assets/individual-catalog.js"></script>');
}

