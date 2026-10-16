import { accessLabel, datasetPath, datasetFilterValue, deliveryLabel, isCatalogSummary, providerLabel } from '../shared/catalog';
import type { CatalogSummary } from '../shared/catalog';
import { INDIVIDUAL_PAGE_SIZE } from '../shared/individual-catalog';
import type { IndividualPage, IndividualSelection } from '../shared/individual-catalog';

const form = document.querySelector<HTMLFormElement>('#individual-search');
if (form) {
  const results = document.querySelector<HTMLElement>('#catalog-results')!;
  const count = document.querySelector<HTMLElement>('#catalog-count')!;
  const pageLabel = document.querySelector<HTMLElement>('#catalog-page')!;
  const previous = document.querySelector<HTMLAnchorElement>('#catalog-prev')!;
  const next = document.querySelector<HTMLAnchorElement>('#catalog-next')!;
  const selection = document.querySelector<HTMLElement>('#dataset-selection')!;
  const fields = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name],select[name]')];
  let pending: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;

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
    for (const value of [entry.itemKind, providerLabel(entry.provider), entry.statusLabel,
      entry.delivery ? deliveryLabel(entry.delivery) : undefined, ...(entry.testOrFixture ? ['Test / demo'] : [])]) {
      if (value) badges.append(element('span', value, 'dataset-tag'));
    }
    const license = element('p', '', 'meta');
    license.append(element('strong', 'License: '), document.createTextNode(entry.license));
    article.append(heading, badges, element('p', entry.description), element('p', accessLabel(entry.access), 'meta'), license);
    return article;
  };
  const query = (page = 1) => {
    const values = new URLSearchParams();
    for (const field of fields) if (field.value.trim()) values.set(field.name, field.value.trim());
    if (page > 1) values.set('page', String(page));
    return values;
  };
  const urlFor = (values: URLSearchParams) => '/hub/datasets/' + (values.size ? `?${values}` : '');
  const updateSelection = (source: IndividualSelection | null) => {
    selection.hidden = !source;
    if (!source) { selection.replaceChildren(); return; }
    const metadata = element('a', 'Collection metadata');
    metadata.href = source.metadataUrl || `/hub/datasets/${source.id}`;
    selection.replaceChildren(document.createTextNode(`Dataset: ${source.label} · ${source.title} · ${source.count.toLocaleString()} entries${source.listingComplete ? '' : ' · source listing incomplete'}. `), metadata);
  };
  const load = async (values: URLSearchParams, focus = false, push = false) => {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const request = ++sequence;
    results.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/hub/datasets/api/entries${values.size ? `?${values}` : ''}`, { signal: controller.signal });
      const data: IndividualPage & { dataset: IndividualSelection | null; error?: string } = await response.json();
      if (!response.ok) throw new Error(data.error || 'Dataset search is unavailable.');
      if (!Array.isArray(data.entries) || data.entries.length > INDIVIDUAL_PAGE_SIZE || !data.entries.every(isCatalogSummary)
        || ![data.page, data.pages, data.total].every(Number.isSafeInteger) || data.page < 1 || data.pages < data.page || data.total < 0) throw new Error('Dataset search returned invalid metadata.');
      if (sequence !== request) return;
      const offset = (data.page - 1) * INDIVIDUAL_PAGE_SIZE;
      results.replaceChildren(...(data.entries.length ? data.entries.map(card) : [element('p', 'No datasets match these filters.')]));
      count.textContent = data.total ? `Showing ${(offset + 1).toLocaleString()}–${(offset + data.entries.length).toLocaleString()} of ${data.total.toLocaleString()} ${data.total === 1 ? 'entry' : 'entries'}` : 'No matching datasets';
      pageLabel.textContent = `Page ${data.page.toLocaleString()} of ${data.pages.toLocaleString()}`;
      previous.hidden = data.page === 1;
      next.hidden = data.page === data.pages;
      previous.href = urlFor(query(data.page - 1));
      next.href = urlFor(query(data.page + 1));
      updateSelection(data.dataset);
      if (push) history.pushState(null, '', urlFor(values)); else history.replaceState(null, '', urlFor(values));
      if (focus) count.focus();
    } catch (error) {
      if (controller.signal.aborted || sequence !== request) return;
      count.textContent = error instanceof Error ? error.message : 'Dataset search is unavailable. Use Search to retry.';
    } finally {
      if (sequence === request) results.removeAttribute('aria-busy');
    }
  };
  const search = () => { clearTimeout(timer); void load(query()); };
  form.addEventListener('input', event => {
    clearTimeout(timer);
    // Cancel an older response immediately, before the input debounce expires.
    pending?.abort();
    sequence++;
    timer = setTimeout(search, event.target instanceof HTMLSelectElement ? 0 : 200);
  });
  form.addEventListener('submit', event => { event.preventDefault(); search(); });
  form.addEventListener('reset', event => {
    event.preventDefault();
    for (const field of fields) field.value = '';
    search();
  });
  for (const link of [previous, next]) link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    clearTimeout(timer);
    void load(new URL(link.href).searchParams, true, true);
  });
  addEventListener('popstate', () => {
    const values = new URLSearchParams(location.search);
    for (const field of fields) field.value = values.get(field.name) || '';
    void load(values);
  });
}
