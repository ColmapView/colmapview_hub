import { accessLabel, CATALOG_PAGE_SIZE, datasetPath, datasetFilterValue, deliveryLabel, filterCatalog, isCatalogSummary, providerLabel } from '../shared/catalog';
import type { CatalogSummary } from '../shared/catalog';
import { licenseCategory, LICENSE_CATEGORY_LABELS } from '../shared/license-categories';

const form = document.querySelector<HTMLFormElement>('#catalog-search');
if (form) {
  const results = document.querySelector<HTMLElement>('#catalog-results')!;
  const count = document.querySelector<HTMLElement>('#catalog-count')!;
  const pageLabel = document.querySelector<HTMLElement>('#catalog-page')!;
  const previous = document.querySelector<HTMLAnchorElement>('#catalog-prev')!;
  const next = document.querySelector<HTMLAnchorElement>('#catalog-next')!;
  const categoryField = form.querySelector<HTMLSelectElement>('[name=licenseCategory]');
  const fields = {
    query: form.querySelector<HTMLInputElement>('[name=q]')!,
    provider: form.querySelector<HTMLSelectElement>('[name=provider]')!,
    license: form.querySelector<HTMLSelectElement>('[name=license]')!,
    ...(categoryField ? { licenseCategory: categoryField } : {}),
    status: form.querySelector<HTMLSelectElement>('[name=status]')!,
    delivery: form.querySelector<HTMLSelectElement>('[name=delivery]')!,
    viewer: form.querySelector<HTMLSelectElement>('[name=viewer]')!,
  };
  let entries: CatalogSummary[] | null = null;
  let currentPage = Number(form.dataset.page) || 1;
  const initial = new URLSearchParams(location.search);
  for (const [key, field] of Object.entries(fields)) field.value = initial.get(key === 'query' ? 'q' : key) || '';
  const requestedPage = Number(initial.get('page'));
  if (Number.isSafeInteger(requestedPage) && requestedPage > 0) currentPage = requestedPage;

  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = className;
    return node;
  };
  const card = (entry: CatalogSummary) => {
    const article = element('article', '', 'card dataset-card');
    const heading = element('h2');
    const link = element('a', entry.title);
    link.href = datasetPath(entry);
    heading.append(link);
    const badges = element('p', '', 'dataset-tags');
    if (entry.dataset) {
      const dataset = element('a', `Dataset: ${entry.dataset.label}`, 'dataset-tag');
      dataset.href = `/hub/datasets/?dataset=${encodeURIComponent(datasetFilterValue(entry))}`;
      badges.append(dataset);
    }
    for (const label of [providerLabel(entry.provider), entry.statusLabel, ...(entry.testOrFixture ? ['Test / demo'] : [])]) badges.append(element('span', label, 'dataset-tag'));
    badges.append(element('span', `License: ${LICENSE_CATEGORY_LABELS[licenseCategory(entry)]}`, 'dataset-tag dataset-license-category'));
    if (entry.delivery) badges.append(element('span', deliveryLabel(entry.delivery), 'dataset-tag'));
    const license = element('p', '', 'meta');
    license.append(element('strong', 'License: '), document.createTextNode(entry.license));
    article.append(heading, badges, element('p', entry.description), element('p', accessLabel(entry.access), 'meta'), license);
    return article;
  };
  const urlFor = (page: number) => {
    const query = new URLSearchParams();
    for (const [key, field] of Object.entries(fields)) if (field.value) query.set(key === 'query' ? 'q' : key, field.value);
    const path = page === 1 ? (form.dataset.collections ? '/hub/datasets/collections' : '/hub/datasets/') : `/hub/datasets/${form.dataset.collections ? 'collection-' : ''}page-${page}`;
    return path + (query.size ? `?${query}` : '');
  };
  const render = (focusCount = false) => {
    if (!entries) return;
    const filtered = filterCatalog(entries, { query: fields.query.value, provider: fields.provider.value, license: fields.license.value, licenseCategory: fields.licenseCategory?.value || '',
      status: fields.status.value, delivery: fields.delivery.value, viewer: fields.viewer.value });
    const pages = Math.max(1, Math.ceil(filtered.length / CATALOG_PAGE_SIZE));
    currentPage = Math.min(currentPage, pages);
    const offset = (currentPage - 1) * CATALOG_PAGE_SIZE;
    const selected = filtered.slice(offset, offset + CATALOG_PAGE_SIZE);
    results.replaceChildren(...(selected.length ? selected.map(card) : [element('p', 'No datasets match these filters.')]));
    count.textContent = filtered.length ? `Showing ${(offset + 1).toLocaleString()}–${(offset + selected.length).toLocaleString()} of ${filtered.length.toLocaleString()} ${filtered.length === 1 ? 'entry' : 'entries'}` : 'No matching datasets';
    pageLabel.textContent = `Page ${currentPage} of ${pages}`;
    previous.hidden = currentPage === 1;
    next.hidden = currentPage === pages;
    previous.href = urlFor(currentPage - 1);
    next.href = urlFor(currentPage + 1);
    history.replaceState(null, '', urlFor(currentPage));
    if (focusCount) count.focus();
  };
  form.addEventListener('input', () => { currentPage = 1; render(); });
  form.addEventListener('submit', event => { event.preventDefault(); currentPage = 1; render(); });
  form.addEventListener('reset', event => {
    event.preventDefault();
    for (const field of Object.values(fields)) field.value = '';
    currentPage = 1;
    render();
  });
  for (const [link, delta] of [[previous, -1], [next, 1]] as const) link.addEventListener('click', event => {
    if (!entries || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    currentPage += delta;
    render(true);
  });
  const load = async () => {
    const response = await fetch('/hub/datasets/catalog-index.json');
    if (!response.ok) throw new Error('Catalog search is unavailable');
    const data: unknown = await response.json();
    if (!Array.isArray(data) || !data.every(isCatalogSummary)) throw new Error('Invalid catalog index');
    entries = data;
    for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,button')) control.disabled = false;
    render();
  };
  void load().catch(() => { count.textContent = 'Search is unavailable. Browse the dataset pages below.'; });
}
