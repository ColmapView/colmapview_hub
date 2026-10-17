import { isCatalogSummary } from '../shared/catalog';
import { INDIVIDUAL_PAGE_SIZE } from '../shared/individual-catalog';
import type { IndividualPage, IndividualSelection } from '../shared/individual-catalog';
import { catalogCardElement } from './catalog-card';

const form = document.querySelector<HTMLFormElement>('#individual-search');
if (form && document.querySelector('#catalog-more') && document.querySelector('#catalog-status')) {
  const results = document.querySelector<HTMLElement>('#catalog-results')!;
  const count = document.querySelector<HTMLElement>('#catalog-count')!;
  const status = document.querySelector<HTMLElement>('#catalog-status')!;
  const pageLabel = document.querySelector<HTMLElement>('#catalog-page')!;
  const previous = document.querySelector<HTMLAnchorElement>('#catalog-prev')!;
  const next = document.querySelector<HTMLAnchorElement>('#catalog-next')!;
  const more = document.querySelector<HTMLButtonElement>('#catalog-more')!;
  const selection = document.querySelector<HTMLElement>('#dataset-selection')!;
  const fields = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name],select[name]')];
  let pending: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  // The select named "dataset" shadows HTMLFormElement.dataset.
  let firstPage = Number(form.getAttribute('data-page')) || 1;
  let lastPage = firstPage;
  let generation = form.getAttribute('data-generation') || '';
  let loaded = results.querySelectorAll('.dataset-card').length;
  let canAppend = true;
  let busy = false;

  const query = (page = 1) => {
    const values = new URLSearchParams();
    for (const field of fields) if (field.value.trim()) values.set(field.name, field.value.trim());
    if (page > 1) values.set('page', String(page));
    return values;
  };
  let committed = query(firstPage);
  const urlFor = (values: URLSearchParams) => '/hub/datasets/' + (values.size ? `?${values}` : '');
  const updateSelection = (source: IndividualSelection | null) => {
    selection.hidden = !source;
    if (!source) { selection.replaceChildren(); return; }
    const metadata = document.createElement('a');
    metadata.textContent = 'Collection metadata';
    metadata.href = source.metadataUrl || `/hub/datasets/${source.id}`;
    selection.replaceChildren(document.createTextNode(`Dataset: ${source.label} · ${source.count.toLocaleString()} entries${source.listingComplete ? '' : ' · listing incomplete'}. `), metadata);
  };
  const load = async (values: URLSearchParams, options: { append?: boolean; focus?: boolean; push?: boolean } = {}): Promise<void> => {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const request = ++sequence;
    busy = true;
    if (!options.append) canAppend = false;
    more.disabled = true;
    more.textContent = options.append ? 'Loading…' : 'Load more';
    status.textContent = options.append ? 'Loading more entries…' : 'Searching…';
    results.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/hub/datasets/api/entries${values.size ? `?${values}` : ''}`, { signal: controller.signal });
      const data: IndividualPage & { dataset: IndividualSelection | null; error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error || 'Dataset search is unavailable.');
      if (!Array.isArray(data.entries) || data.entries.length > INDIVIDUAL_PAGE_SIZE || !data.entries.every(isCatalogSummary)
        || typeof data.generation !== 'string' || ![data.page, data.pages, data.total].every(Number.isSafeInteger)
        || data.page < 1 || data.pages < data.page || data.total < 0) throw new Error('Dataset search returned invalid metadata.');
      if (sequence !== request) return;
      if (options.append && generation && generation !== data.generation) {
        const refreshed = new URLSearchParams(values);
        refreshed.delete('page');
        return await load(refreshed);
      }
      const cards = data.entries.map(catalogCardElement);
      if (options.append) {
        const existing = new Set([...results.querySelectorAll<HTMLElement>('[data-entry-id]')].map(card => card.dataset.entryId));
        if (data.entries.some(entry => existing.has(entry.id))) throw new Error('The catalog changed. Use Search to refresh these results.');
        results.append(...cards);
        loaded += cards.length;
      } else {
        results.replaceChildren(...(cards.length ? cards : [Object.assign(document.createElement('p'), { textContent: 'No datasets match these filters.' })]));
        firstPage = data.page;
        loaded = cards.length;
      }
      lastPage = data.page;
      generation = data.generation;
      canAppend = true;
      committed = new URLSearchParams(values);
      if (firstPage > 1) committed.set('page', String(firstPage)); else committed.delete('page');
      const offset = (firstPage - 1) * INDIVIDUAL_PAGE_SIZE;
      count.textContent = data.total ? `Showing ${(offset + 1).toLocaleString()}–${(offset + loaded).toLocaleString()} of ${data.total.toLocaleString()} ${data.total === 1 ? 'entry' : 'entries'}` : 'No matching datasets';
      pageLabel.textContent = `${loaded.toLocaleString()} loaded`;
      previous.hidden = firstPage === 1;
      const previousQuery = new URLSearchParams(committed);
      if (firstPage > 2) previousQuery.set('page', String(firstPage - 1)); else previousQuery.delete('page');
      previous.href = urlFor(previousQuery);
      more.hidden = lastPage >= data.pages;
      updateSelection(data.dataset);
      if (options.push) history.pushState(null, '', urlFor(committed)); else history.replaceState(null, '', urlFor(committed));
      status.textContent = options.append ? `Loaded ${cards.length} more entries.` : '';
      if (options.focus) (options.append ? cards[0]?.querySelector<HTMLElement>('a') : count)?.focus();
    } catch (error) {
      if (controller.signal.aborted || sequence !== request) return;
      status.textContent = error instanceof Error ? error.message : 'Dataset search is unavailable. Use Search to retry.';
      if (options.append) more.textContent = 'Retry loading more';
    } finally {
      if (sequence === request) {
        busy = false;
        results.removeAttribute('aria-busy');
        more.disabled = !canAppend;
        if (more.textContent === 'Loading…') more.textContent = 'Load more';
      }
    }
  };
  const search = () => { clearTimeout(timer); void load(query()); };
  form.addEventListener('input', event => {
    clearTimeout(timer);
    pending?.abort();
    sequence++;
    canAppend = false;
    more.disabled = true;
    timer = setTimeout(search, event.target instanceof HTMLSelectElement ? 0 : 200);
  });
  form.addEventListener('submit', event => { event.preventDefault(); search(); });
  form.addEventListener('reset', event => {
    event.preventDefault();
    for (const field of fields) field.value = '';
    search();
  });
  more.hidden = next.hidden;
  next.hidden = true;
  more.addEventListener('click', event => {
    if (busy || !canAppend) return;
    const values = new URLSearchParams(committed);
    values.set('page', String(lastPage + 1));
    void load(values, { append: true, focus: event.detail === 0 });
  });
  previous.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    clearTimeout(timer);
    void load(new URL(previous.href).searchParams, { focus: true, push: true });
  });
  addEventListener('popstate', () => {
    const values = new URLSearchParams(location.search);
    for (const field of fields) field.value = values.get(field.name) || '';
    void load(values);
  });
}
