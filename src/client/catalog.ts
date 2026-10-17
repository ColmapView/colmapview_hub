import { CATALOG_PAGE_SIZE, filterCatalog, isCatalogSummary } from '../shared/catalog';
import type { CatalogSummary } from '../shared/catalog';
import { catalogCardElement } from './catalog-card';
import { catalogHistory } from './catalog-history';
import type { CatalogHistoryMode } from './catalog-history';

const form = document.querySelector<HTMLFormElement>('#catalog-search');
const more = document.querySelector<HTMLButtonElement>('#catalog-more');
if (form && more) {
  const results = document.querySelector<HTMLElement>('#catalog-results')!;
  const count = document.querySelector<HTMLElement>('#catalog-count')!;
  const status = document.querySelector<HTMLElement>('#catalog-status');
  const retry = document.querySelector<HTMLButtonElement>('#catalog-retry');
  const initialCount = count.textContent || '';
  const pageLabel = document.querySelector<HTMLElement>('#catalog-page')!;
  const previous = document.querySelector<HTMLAnchorElement>('#catalog-prev')!;
  const next = document.querySelector<HTMLAnchorElement>('#catalog-next')!;
  const fields = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name],select[name]')];
  const navigation = catalogHistory(form);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let entries: CatalogSummary[] | null = null;
  let firstPage = Number(form.getAttribute('data-page')) || 1;
  let lastPage = firstPage;
  const initial = new URLSearchParams(location.search);
  for (const field of fields) field.value = initial.get(field.name) || '';
  const advanced = form.querySelector<HTMLDetailsElement>('.catalog-advanced');
  if (advanced && ['license', 'status', 'delivery', 'viewer'].some(name => initial.has(name))) advanced.open = true;
  const requestedPage = Number(initial.get('page'));
  if (Number.isSafeInteger(requestedPage) && requestedPage > 0) firstPage = lastPage = requestedPage;
  const value = (name: string) => fields.find(field => field.name === name)?.value || '';
  const urlFor = (page: number) => {
    const query = new URLSearchParams();
    for (const field of fields) if (field.value) query.set(field.name, field.value);
    const path = page === 1 ? '/hub/datasets/collections' : `/hub/datasets/collection-page-${page}`;
    return path + (query.size ? `?${query}` : '');
  };
  const render = (append = false, focus = false, history: CatalogHistoryMode = 'replace') => {
    if (!entries) return;
    const filtered = filterCatalog(entries, { query: value('q'), provider: value('provider'), license: value('license'), licenseCategory: value('licenseCategory'),
      status: value('status'), delivery: value('delivery'), viewer: value('viewer') });
    const pages = Math.max(1, Math.ceil(filtered.length / CATALOG_PAGE_SIZE));
    firstPage = Math.min(firstPage, pages);
    lastPage = append ? Math.min(lastPage + 1, pages) : firstPage;
    const offset = (firstPage - 1) * CATALOG_PAGE_SIZE;
    const selected = filtered.slice(append ? (lastPage - 1) * CATALOG_PAGE_SIZE : offset, lastPage * CATALOG_PAGE_SIZE);
    const cards = selected.map(catalogCardElement);
    if (append) results.append(...cards);
    else results.replaceChildren(...(cards.length ? cards : [Object.assign(document.createElement('p'), { textContent: 'No datasets match these filters.' })]));
    const loaded = Math.min(lastPage * CATALOG_PAGE_SIZE, filtered.length) - offset;
    count.textContent = filtered.length ? `Showing ${(offset + 1).toLocaleString()}–${(offset + loaded).toLocaleString()} of ${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'entry' : 'entries'}` : 'No matching datasets';
    pageLabel.textContent = `${Math.max(0, loaded).toLocaleString()} loaded`;
    previous.hidden = firstPage === 1;
    more.hidden = lastPage >= pages;
    more.disabled = false;
    next.hidden = true;
    previous.href = urlFor(firstPage - 1);
    navigation.prepare(history)(urlFor(firstPage));
    if (focus) (append ? cards[0]?.querySelector<HTMLElement>('a') : count)?.focus();
  };
  const search = (history: CatalogHistoryMode = 'push') => { clearTimeout(timer); firstPage = 1; render(false, false, history); };
  form.addEventListener('input', event => {
    clearTimeout(timer);
    more.disabled = true;
    const select = event.target instanceof HTMLSelectElement;
    timer = setTimeout(() => search(select ? 'push' : 'typing'), select ? 0 : 200);
  });
  form.addEventListener('submit', event => { event.preventDefault(); search(); });
  form.addEventListener('reset', event => {
    event.preventDefault();
    for (const field of fields) field.value = '';
    search();
  });
  previous.addEventListener('click', event => {
    if (!entries || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    clearTimeout(timer);
    const values = new URL(previous.href).searchParams;
    for (const field of fields) field.value = values.get(field.name) || '';
    firstPage--;
    render(false, true, 'push');
  });
  more.addEventListener('click', event => render(true, event.detail === 0));
  addEventListener('popstate', () => {
    clearTimeout(timer);
    const values = new URLSearchParams(location.search);
    for (const field of fields) field.value = values.get(field.name) || '';
    if (advanced && ['license', 'status', 'delivery', 'viewer'].some(name => values.has(name))) advanced.open = true;
    const page = /\/collection-page-(\d+)$/.exec(location.pathname)?.[1] || values.get('page');
    firstPage = Number(page) || 1;
    render();
  });
  let loading = false;
  const load = async () => {
    if (loading) return;
    loading = true;
    const focus = retry === document.activeElement;
    if (retry) retry.disabled = true;
    if (status) status.textContent = 'Loading collection search…';
    try {
      const response = await fetch('/hub/datasets/catalog-index.json');
      if (!response.ok) throw new Error('Catalog search is unavailable');
      const data: unknown = await response.json();
      if (!Array.isArray(data) || !data.every(isCatalogSummary)) throw new Error('Invalid catalog index');
      entries = data;
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')) control.disabled = false;
      render(false, focus);
      if (status) status.textContent = '';
      if (retry) retry.hidden = true;
    } catch {
      count.textContent = `Unfiltered collections · ${initialCount}`;
      const message = 'Collection search is unavailable. Retry, or browse the pages below.';
      if (status) status.textContent = message; else count.textContent = message;
      if (retry) retry.hidden = false;
    } finally {
      loading = false;
      if (retry) retry.disabled = false;
    }
  };
  retry?.addEventListener('click', () => { void load(); });
  void load();
}
