import { isCatalogSummary } from '../shared/catalog';
import { INDIVIDUAL_PAGE_SIZE, savedFilterSummary } from '../shared/individual-catalog';
import type { IndividualPage, IndividualSelection } from '../shared/individual-catalog';
import { catalogCardElement } from './catalog-card';
import { catalogHistory } from './catalog-history';
import type { CatalogHistoryMode } from './catalog-history';
import { recallFeed, rememberFeed, restoreFeedPosition } from './feed-memory';
import { defaultFeedSeed, FEED_MODES } from '../shared/discovery';

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
  const savedFilters = document.querySelector<HTMLElement>('#catalog-saved-filters')!;
  const end = document.querySelector<HTMLElement>('#catalog-end')!;
  const sentinel = document.querySelector<HTMLElement>('#catalog-sentinel')!;
  const notes = document.querySelector<HTMLDetailsElement>('.catalog-notes');
  const fields = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input[name],select[name]')];
  const navigation = catalogHistory(form);
  let pending: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let stopRestoring: (() => void) | undefined;
  let restoring = false;
  let departing: HTMLElement | null = null;
  // The feed owns its return anchor; native scrollY restoration uses stale
  // estimated heights when content-visibility has deferred offscreen cards.
  history.scrollRestoration = 'manual';
  // The select named "dataset" shadows HTMLFormElement.dataset.
  let firstPage = Number(form.getAttribute('data-page')) || 1;
  let lastPage = firstPage;
  let generation = form.getAttribute('data-generation') || '';
  let loaded = results.querySelectorAll('.dataset-card').length;
  let canAppend = true;
  let busy = false;
  let committedCount = count.textContent || '';
  let total = Number(form.getAttribute('data-total')) || 0;
  let pages = Number(form.getAttribute('data-pages')) || 1;
  let automaticPaused = false;
  let nearEnd = false;
  let entries: IndividualPage['entries'] = [];
  try {
    const initial: IndividualPage = JSON.parse(document.querySelector('#catalog-initial-data')?.textContent || '{}');
    if (Array.isArray(initial.entries) && initial.entries.every(isCatalogSummary)) entries = initial.entries;
  } catch { /* The server-rendered page still works when initial metadata is absent. */ }

  const query = (page = 1) => {
    const values = new URLSearchParams();
    for (const field of fields) if (field.value.trim()) values.set(field.name, field.value.trim());
    if (page > 1) values.set('page', String(page));
    return values;
  };
  let committed = query(firstPage);
  const urlFor = (values: URLSearchParams) => {
    const visible = new URLSearchParams(values);
    visible.delete('seed');
    return '/hub/datasets/' + (visible.size ? `?${visible}` : '');
  };
  const documentNavigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const serverSeed = committed.get('seed') || undefined;
  const returningSeed = documentNavigation?.type === 'back_forward' ? navigation.feedSeed() : undefined;
  const initialSeed = returningSeed || serverSeed;
  if (initialSeed) {
    committed.set('seed', initialSeed);
    fields.find(field => field.name === 'seed')!.value = initialSeed;
  }
  // Equal visible URLs can represent different shuffled visits. Keep their
  // seeds in history state and use both values to identify a return snapshot.
  navigation.prepare('replace')(urlFor(new URLSearchParams(location.search)), initialSeed);
  const key = () => JSON.stringify([location.pathname + location.search, navigation.feedSeed()]);
  let viewKey = key();
  const remember = () => {
    // popstate can arrive before the first restored frame. Do not replace the
    // saved anchor with the new document's temporary position at the top.
    if (restoring || !entries.length || entries.length !== loaded) return;
    const cards = [...results.querySelectorAll<HTMLElement>('[data-entry-id]')];
    const focused = document.activeElement?.closest<HTMLElement>('[data-entry-id]');
    const preferred = departing?.isConnected ? departing : focused;
    const preferredIndex = preferred ? cards.indexOf(preferred) : -1;
    const areas = cards.map(card => { const box = card.getBoundingClientRect(); return Math.max(0, Math.min(box.bottom, innerHeight) - Math.max(box.top, 0)); });
    const selected = Boolean(departing?.isConnected);
    const visible = preferredIndex >= 0 && (selected || areas[preferredIndex] > 0) ? preferredIndex : Math.max(0, areas.indexOf(Math.max(...areas)));
    const start = Math.max(0, Math.floor(visible / INDIVIDUAL_PAGE_SIZE) * INDIVIDUAL_PAGE_SIZE - 96);
    const cached = entries.slice(start, start + 240);
    rememberFeed({ key: viewKey, query: committed.toString(), data: { entries: cached, page: firstPage + start / INDIVIDUAL_PAGE_SIZE,
      pages, total, generation }, lastPage: firstPage + start / INDIVIDUAL_PAGE_SIZE + Math.ceil(cached.length / INDIVIDUAL_PAGE_SIZE) - 1,
    collectionText: selection.textContent || '', anchor: cards[visible] ? { id: entries[visible].id,
      top: selected && areas[visible] === 0 ? 0 : cards[visible].getBoundingClientRect().top } : null });
  };
  const updateNavigation = () => {
    const offset = (firstPage - 1) * INDIVIDUAL_PAGE_SIZE;
    count.textContent = total ? `Showing ${(offset + 1).toLocaleString()}–${(offset + loaded).toLocaleString()} of ${total.toLocaleString()} ${total === 1 ? 'scene dataset' : 'scene datasets'}` : 'No matching datasets';
    committedCount = count.textContent;
    pageLabel.textContent = `${loaded.toLocaleString()} loaded`;
    previous.hidden = firstPage === 1;
    const previousQuery = new URLSearchParams(committed);
    if (firstPage > 2) previousQuery.set('page', String(firstPage - 1)); else previousQuery.delete('page');
    previous.href = urlFor(previousQuery);
    const shuffleQuery = new URLSearchParams(committed);
    shuffleQuery.delete('page');
    document.querySelectorAll<HTMLAnchorElement>('#catalog-shuffle, #catalog-reshuffle').forEach(link => { link.href = urlFor(shuffleQuery); });
    more.hidden = lastPage >= pages;
    end.hidden = !total || lastPage < pages;
    savedFilters.textContent = savedFilterSummary(committed);
    savedFilters.hidden = !savedFilters.textContent;
  };
  const restore = () => {
    const saved = recallFeed(key(), generation);
    if (!saved) return false;
    pending?.abort();
    const request = ++sequence;
    stopRestoring?.();
    restoring = true;
    departing = null;
    committed = new URLSearchParams(saved.query);
    viewKey = key();
    firstPage = saved.data.page; lastPage = saved.lastPage;
    if (firstPage > 1) committed.set('page', String(firstPage)); else committed.delete('page');
    entries = saved.data.entries; loaded = entries.length; total = saved.data.total; pages = saved.data.pages;
    for (const field of fields) field.value = committed.get(field.name) || '';
    results.replaceChildren(...entries.map(catalogCardElement));
    results.removeAttribute('aria-busy');
    selection.textContent = saved.collectionText; selection.hidden = !saved.collectionText;
    status.textContent = ''; canAppend = true; more.disabled = false; automaticPaused = false;
    updateNavigation();
    busy = true;
    stopRestoring = restoreFeedPosition(results, saved.anchor, () => {
      if (request !== sequence) return;
      restoring = false;
      busy = false;
      requestAnimationFrame(() => continueAutomatic());
    });
    return true;
  };
  const updateSelection = (source: IndividualSelection | null) => {
    selection.hidden = !source;
    if (!source) { selection.replaceChildren(); return; }
    selection.textContent = `Collection: ${source.label} · ${source.count.toLocaleString()} scenes${source.listingComplete ? '' : ' · listing incomplete'}.`;
  };
  const load = async (values: URLSearchParams, options: { append?: boolean; focus?: boolean; history?: CatalogHistoryMode; restoring?: boolean } = {}): Promise<void> => {
    if (!options.append && !options.restoring) remember();
    const updateHistory = navigation.prepare(options.history);
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    const request = ++sequence;
    stopRestoring?.();
    restoring = false;
    busy = true;
    if (!options.append) canAppend = false;
    more.disabled = true;
    more.textContent = options.append ? 'Loading…' : 'Load more';
    status.textContent = options.append ? 'Loading more scenes…' : 'Searching…';
    results.setAttribute('aria-busy', 'true');
    let failure = options.append ? 'Could not load more scenes. Try again.' : 'Dataset search is unavailable. Use Search to retry.';
    try {
      const response = await fetch(`/hub/datasets/api/entries${values.size ? `?${values}` : ''}`, { signal: controller.signal });
      const data: (IndividualPage & { dataset: IndividualSelection | null; error?: string }) | null = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 400 && typeof data?.error === 'string') failure = data.error;
        throw new Error(failure);
      }
      if (!data || !Array.isArray(data.entries) || data.entries.length > INDIVIDUAL_PAGE_SIZE || !data.entries.every(isCatalogSummary)
        || typeof data.generation !== 'string' || ![data.page, data.pages, data.total].every(Number.isSafeInteger)
        || data.page < 1 || data.pages < data.page || data.total < 0 || data.page !== Number(values.get('page') || 1)
        || data.pages !== Math.max(1, Math.ceil(data.total / INDIVIDUAL_PAGE_SIZE))
        || data.entries.length !== Math.min(INDIVIDUAL_PAGE_SIZE, Math.max(0, data.total - (data.page - 1) * INDIVIDUAL_PAGE_SIZE))
        || new Set(data.entries.map(entry => entry.id)).size !== data.entries.length
        || data.feed && (!FEED_MODES.includes(data.feed.mode) || !/^[a-f0-9]{8,32}$/.test(data.feed.seed))) {
        failure = 'Dataset search returned incomplete metadata. Use Search to retry.';
        throw new Error(failure);
      }
      if (sequence !== request) return;
      if (options.append && generation && generation !== data.generation) {
        const refreshed = new URLSearchParams(values);
        refreshed.delete('page');
        return await load(refreshed);
      }
      // Preserve an open metadata panel during a replacement search, and keep
      // catalog notes stationary if an in-flight append finishes while reading.
      const panel = options.append ? (notes?.open ? notes : null)
        : results.querySelector<HTMLDialogElement>('.dataset-metadata[open]');
      const panelEntry = panel?.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId;
      if (panel) {
        const closeEvent = options.append ? 'toggle' : 'close';
        await new Promise<void>(resolve => {
          const finish = () => {
            if (panel.open && !controller.signal.aborted) return;
            panel.removeEventListener(closeEvent, finish);
            controller.signal.removeEventListener('abort', finish);
            resolve();
          };
          panel.addEventListener(closeEvent, finish);
          controller.signal.addEventListener('abort', finish, { once: true });
          if (!panel.open || controller.signal.aborted) finish();
        });
        if (controller.signal.aborted || sequence !== request) return;
      }
      const cards = data.entries.map(catalogCardElement);
      if (data.feed) {
        if (options.append && (data.feed.seed !== committed.get('seed') || data.feed.mode !== (committed.get('sort') || 'discover'))) {
          failure = 'The feed order changed. Use Search to refresh these results.';
          throw new Error(failure);
        }
        values.set('seed', data.feed.seed);
        fields.find(field => field.name === 'seed')!.value = data.feed.seed;
      }
      if (options.append) {
        const existing = new Set([...results.querySelectorAll<HTMLElement>('[data-entry-id]')].map(card => card.dataset.entryId));
        if (data.entries.some(entry => existing.has(entry.id))) {
          failure = 'The catalog changed. Use Search to refresh these results.';
          throw new Error(failure);
        }
        results.append(...cards);
        entries.push(...data.entries);
        loaded += cards.length;
      } else {
        results.replaceChildren(...(cards.length ? cards : [Object.assign(document.createElement('p'), { textContent: 'No datasets match these filters.' })]));
        firstPage = data.page;
        entries = data.entries;
        loaded = cards.length;
      }
      lastPage = data.page;
      total = data.total; pages = data.pages;
      generation = data.generation;
      canAppend = true;
      committed = new URLSearchParams(values);
      if (firstPage > 1) committed.set('page', String(firstPage)); else committed.delete('page');
      updateNavigation();
      updateSelection(data.dataset);
      updateHistory(urlFor(committed), committed.get('seed') || undefined);
      viewKey = key();
      departing = null;
      automaticPaused = false;
      if (!options.append && !options.restoring) scrollTo(0, 0);
      status.textContent = options.append ? `Loaded ${cards.length} more scenes.` : '';
      if (options.focus) (options.append ? cards[0]?.querySelector<HTMLElement>('a') : count)?.focus();
      else if (panelEntry) {
        const replacement = [...results.querySelectorAll<HTMLElement>('[data-entry-id]')].find(card => card.dataset.entryId === panelEntry);
        (replacement?.querySelector<HTMLElement>('.dataset-info') || count).focus({ preventScroll: true });
      }
    } catch {
      if (controller.signal.aborted || sequence !== request) return;
      status.textContent = failure;
      automaticPaused = true;
      if (!options.append) count.textContent = `Previous results · ${committedCount}`;
      if (options.append) more.textContent = 'Retry loading more';
    } finally {
      if (sequence === request) {
        busy = false;
        results.removeAttribute('aria-busy');
        more.disabled = !canAppend;
        if (more.textContent === 'Loading…') more.textContent = 'Load more';
        requestAnimationFrame(() => continueAutomatic());
      }
    }
  };
  const search = (history: CatalogHistoryMode = 'push') => { clearTimeout(timer); void load(query(), { history }); };
  form.addEventListener('input', event => {
    stopRestoring?.();
    clearTimeout(timer);
    pending?.abort();
    sequence++;
    canAppend = false;
    more.disabled = true;
    const select = event.target instanceof HTMLSelectElement;
    if (select && (event.target as HTMLSelectElement).name === 'sort') freshSeed();
    timer = setTimeout(() => search(select ? 'push' : 'typing'), select ? 0 : 200);
  });
  form.addEventListener('submit', event => { event.preventDefault(); search(); });
  form.querySelector<HTMLAnchorElement>('#catalog-reset')!.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    for (const field of fields) field.value = '';
    search();
  });
  const freshSeed = () => {
    fields.find(field => field.name === 'seed')!.value = defaultFeedSeed();
  };
  document.querySelectorAll<HTMLAnchorElement>('#catalog-shuffle, #catalog-reshuffle').forEach(link => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); freshSeed(); search();
  }));
  more.hidden = next.hidden;
  next.hidden = true;
  const appendMore = (focus = false) => {
    if (busy || !canAppend) return;
    if (lastPage >= pages || document.querySelector('.dataset-metadata[open]')) return;
    const values = new URLSearchParams(committed);
    values.set('page', String(lastPage + 1));
    void load(values, { append: true, focus });
  };
  const continueAutomatic = () => {
    if (!nearEnd || automaticPaused || document.hidden || notes?.open) return;
    const bounds = sentinel.getBoundingClientRect();
    if (bounds.top <= innerHeight + 600 && bounds.bottom >= -600) appendMore();
  };
  more.addEventListener('click', event => {
    if (notes) notes.open = false;
    automaticPaused = false; appendMore(event.detail === 0);
  });
  notes?.addEventListener('toggle', () => { if (!notes.open) continueAutomatic(); });
  previous.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    clearTimeout(timer);
    const values = new URL(previous.href).searchParams;
    if (committed.has('seed')) values.set('seed', committed.get('seed')!);
    for (const field of fields) field.value = values.get(field.name) || '';
    void load(values, { focus: true, history: 'push' });
  });
  addEventListener('popstate', () => {
    clearTimeout(timer);
    remember();
    if (restore()) return;
    const values = new URLSearchParams(location.search);
    const seed = navigation.feedSeed();
    if (seed) values.set('seed', seed);
    for (const field of fields) field.value = values.get(field.name) || '';
    const advanced = form.querySelector<HTMLDetailsElement>('.catalog-advanced');
    if (advanced && ['provider', 'license', 'status', 'photos', 'data'].some(name => values.has(name))) advanced.open = true;
    void load(values, { restoring: true });
  });
  updateNavigation();
  if (committed.has('seed') && documentNavigation?.type === 'reload') {
    freshSeed();
    void load(query(), { history: 'replace' });
  } else if (!restore() && returningSeed && returningSeed !== serverSeed) {
    // History survives even when session storage is unavailable. Re-fetch the
    // returning visit's seed instead of using the fresh server-rendered order.
    void load(query(firstPage), { restoring: true });
  }
  addEventListener('pagehide', remember);
  results.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0 || !(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('.dataset-open, .dataset-metadata-links a');
    if (link && link.target !== '_blank') departing = link.closest<HTMLElement>('[data-entry-id]');
  }, true);
  document.addEventListener('close', event => {
    if (event.target instanceof HTMLDialogElement && event.target.classList.contains('dataset-metadata')) continueAutomatic();
  }, true);
  document.addEventListener('visibilitychange', continueAutomatic);
  if (typeof IntersectionObserver !== 'undefined') {
    const observer = new IntersectionObserver(changes => {
      nearEnd = changes.some(change => change.isIntersecting);
      continueAutomatic();
    }, { rootMargin: '600px 0px' });
    observer.observe(sentinel);
  }
}
