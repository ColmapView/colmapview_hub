import { catalogExtraFilterCount, catalogFilterState, emptyCatalogHtml } from '../shared/catalog-controls';
import { isCatalogSummary } from '../shared/catalog';
import { INDIVIDUAL_PAGE_SIZE, savedFilterSummary } from '../shared/individual-catalog';
import type { IndividualPage, IndividualSelection } from '../shared/individual-catalog';
import { catalogCardElement } from './catalog-card';
import { catalogHistory } from './catalog-history';
import type { CatalogHistoryMode } from './catalog-history';
import { recallFeed, rememberFeed, restoreFeedPosition } from './feed-memory';
import { defaultFeedSeed, FEED_MODES } from '../shared/discovery';
import { catalogViewerHost, hubApiBase, hubFrontend } from './hosting';
import { refreshCatalogFilters } from './catalog-config';
import { catalogRequest } from './catalog-request';

const form = document.querySelector<HTMLFormElement>('#individual-search');
if (form && document.querySelector('#catalog-more') && document.querySelector('#catalog-status')) {
  const host = catalogViewerHost();
  const staticFrontend = Boolean(hubFrontend());
  const results = document.querySelector<HTMLElement>('#catalog-results')!;
  const count = document.querySelector<HTMLElement>('#catalog-count')!;
  const status = document.querySelector<HTMLElement>('#catalog-status')!;
  const notice = document.querySelector<HTMLElement>('#catalog-notice');
  const feedback = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle('sr-only', !error);
    if (notice) notice.hidden = error;
  };
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
  if (staticFrontend) {
    form.inert = true;
    const values = new URLSearchParams(location.search);
    for (const field of fields) field.value = field.name === 'viewerHost' ? 'github' : values.get(field.name) || '';
  }
  const primary = form.querySelector<HTMLElement>('.catalog-primary')!;
  const secondary = form.querySelector<HTMLElement>('.catalog-filter-basics')!;
  const extraFilters = form.querySelector<HTMLDetailsElement>('.catalog-filter-details')!;
  const revealExtraFilters = (values: URLSearchParams) => {
    if (catalogExtraFilterCount(values)) extraFilters.open = true;
  };
  revealExtraFilters(new URLSearchParams(location.search));
  const primaryFilters = [...primary.querySelectorAll<HTMLElement>(':scope > .catalog-field')];
  const submit = primary.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const compact = matchMedia('(max-width: 1100px)');
  const arrangeFilters = () => {
    const focused = document.activeElement;
    if (compact.matches) secondary.prepend(...primaryFilters);
    else for (const field of primaryFilters) primary.insertBefore(field, submit);
    if (focused instanceof HTMLElement && primaryFilters.some(field => field.contains(focused))) focused.focus({ preventScroll: true });
  };
  compact.addEventListener('change', arrangeFilters);
  arrangeFilters();
  const panels = [...document.querySelectorAll<HTMLDetailsElement>('.catalog-advanced, .catalog-notes')];
  document.addEventListener('click', event => {
    for (const panel of panels) if (panel.open && event.target instanceof Node && !panel.contains(event.target)) panel.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.dataset-metadata[open]')) return;
    const panel = panels.find(panel => panel.open);
    if (!panel) return;
    event.preventDefault(); panel.open = false;
    panel.querySelector('summary')?.focus({ preventScroll: true });
  });
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
  if (staticFrontend) firstPage = Math.max(1, Number(new URLSearchParams(location.search).get('page')) || 1);
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
    for (const field of fields) if (field.value.trim() && !(staticFrontend && field.name === 'viewerHost')) values.set(field.name, field.value.trim());
    if (page > 1) values.set('page', String(page));
    return values;
  };
  let committed = query(firstPage);
  const urlFor = (values: URLSearchParams) => {
    const visible = new URLSearchParams(values);
    visible.delete('seed');
    return '/hub/' + (visible.size ? `?${visible}` : '');
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
    const viewportTop = document.querySelector('.catalog-toolbar')!.getBoundingClientRect().bottom;
    const viewportBottom = document.querySelector('.catalog-footbar')!.getBoundingClientRect().top;
    const areas = cards.map(card => { const box = card.getBoundingClientRect(); return Math.max(0, Math.min(box.bottom, viewportBottom) - Math.max(box.top, viewportTop)); });
    const selected = Boolean(departing?.isConnected);
    const visible = preferredIndex >= 0 && (selected || areas[preferredIndex] > 0) ? preferredIndex : Math.max(0, areas.indexOf(Math.max(...areas)));
    const start = Math.max(0, Math.floor(visible / INDIVIDUAL_PAGE_SIZE) * INDIVIDUAL_PAGE_SIZE - 96);
    const cached = entries.slice(start, start + 240);
    rememberFeed({ key: viewKey, query: committed.toString(), data: { entries: cached, page: firstPage + start / INDIVIDUAL_PAGE_SIZE,
      pages, total, generation }, lastPage: firstPage + start / INDIVIDUAL_PAGE_SIZE + Math.ceil(cached.length / INDIVIDUAL_PAGE_SIZE) - 1,
    collectionText: selection.textContent || '', anchor: cards[visible] ? { id: entries[visible].id,
      top: selected && areas[visible] === 0 ? viewportTop : cards[visible].getBoundingClientRect().top } : null });
  };
  const updateNavigation = () => {
    const offset = (firstPage - 1) * INDIVIDUAL_PAGE_SIZE;
    const description = total ? `Showing ${(offset + 1).toLocaleString()}–${(offset + loaded).toLocaleString()} of ${total.toLocaleString()} ${total === 1 ? 'scene dataset' : 'scene datasets'}` : 'No matching datasets';
    count.textContent = total ? total.toLocaleString() : 'No matches';
    count.setAttribute('aria-label', description);
    count.title = description;
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
    const labels = Object.fromEntries(fields.filter((field): field is HTMLSelectElement => field instanceof HTMLSelectElement)
      .map(field => [field.name, field.selectedOptions[0]?.textContent || field.value]));
    const active = catalogFilterState(committed, labels);
    const advanced = form.querySelector('.catalog-advanced')!;
    advanced.toggleAttribute('data-active', active.count > 0);
    const summary = advanced.querySelector('summary')!;
    summary.title = active.description;
    summary.querySelector('[data-filter-description]')!.textContent = active.description;
    const badge = summary.querySelector<HTMLElement>('.catalog-filter-count')!;
    badge.textContent = String(active.count); badge.hidden = !active.count;
    const extraCount = catalogExtraFilterCount(committed);
    const extraBadge = extraFilters.querySelector<HTMLElement>('[data-extra-count]')!;
    extraBadge.textContent = `${extraCount} active`; extraBadge.hidden = !extraCount;
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
    revealExtraFilters(committed);
    results.replaceChildren(...entries.map(entry => catalogCardElement(entry, host)));
    results.removeAttribute('aria-busy');
    selection.textContent = saved.collectionText; selection.hidden = !saved.collectionText;
    feedback(''); canAppend = true; more.disabled = false; automaticPaused = false;
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
    feedback(options.append ? 'Loading more scenes…' : 'Searching…');
    count.textContent = options.append ? 'Loading…' : 'Searching…';
    count.title = count.textContent;
    count.setAttribute('aria-label', count.title);
    results.setAttribute('aria-busy', 'true');
    results.toggleAttribute('data-searching', !options.append);
    let failure = options.append ? 'Could not load more scenes. Try again.' : 'Dataset search is unavailable. Use Search to retry.';
    try {
      const response = await catalogRequest(`${hubApiBase()}/datasets/api/entries${values.size ? `?${values}` : ''}`, controller.signal);
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
      const cards = data.entries.map(entry => catalogCardElement(entry, host));
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
        if (cards.length) results.replaceChildren(...cards);
        else results.innerHTML = emptyCatalogHtml(document.querySelector<HTMLAnchorElement>('#catalog-reset')!.href);
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
      feedback(options.append ? `Loaded ${cards.length} more scenes.` : '');
      if (options.focus) (options.append ? cards[0]?.querySelector<HTMLElement>('a') : notice || count)?.focus();
      else if (panelEntry) {
        const replacement = [...results.querySelectorAll<HTMLElement>('[data-entry-id]')].find(card => card.dataset.entryId === panelEntry);
        (replacement?.querySelector<HTMLElement>('.dataset-info') || notice || count).focus({ preventScroll: true });
      }
    } catch {
      if (controller.signal.aborted || sequence !== request) return;
      feedback(failure, true);
      automaticPaused = true;
      count.textContent = committedCount;
      count.title = `Previous results · ${committedCount}`;
      count.setAttribute('aria-label', count.title);
      if (options.append) more.textContent = 'Retry loading more';
    } finally {
      if (sequence === request) {
        busy = false;
        results.removeAttribute('aria-busy');
        results.removeAttribute('data-searching');
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
  document.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0 || !(event.target instanceof Element)) return;
    if (!event.target.closest('#catalog-reset, [data-clear-catalog]')) return;
    event.preventDefault();
    for (const field of fields) if (field.name !== 'viewerHost') field.value = '';
    if (event.target.closest('[data-clear-catalog]')) form.querySelector<HTMLInputElement>('input[name="q"]')?.focus({ preventScroll: true });
    search();
  });
  const freshSeed = () => {
    const field = fields.find(field => field.name === 'seed')!;
    field.value = defaultFeedSeed(field.value);
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
    revealExtraFilters(values);
    void load(values, { restoring: true });
  });
  updateNavigation();
  if (staticFrontend) {
    const requested = new URLSearchParams(location.search);
    void refreshCatalogFilters(form).then(value => { generation = value; }).catch(() => { /* Existing shell choices remain usable during an index retry. */ })
      .then(() => {
        for (const field of fields) field.value = field.name === 'viewerHost' ? 'github' : requested.get(field.name) || '';
        form.inert = false;
        if (!restore()) void load(query(firstPage), { history: 'replace' });
      });
  } else if (committed.has('seed') && documentNavigation?.type === 'reload') {
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
