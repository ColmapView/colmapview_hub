type Parameters = Record<string, string | number | boolean>;
type Track = (name: string, parameters: Parameters) => void;

/** Explicit public UI actions; never send text, hrefs, queries or shared-link IDs. */
export function initializeHubUsage(track: Track): void {
  const dataset = (target: Element): Parameters => {
    const id = target.closest<HTMLElement>('[data-entry-id]')?.dataset.entryId ?? '';
    return /^data-[a-f0-9]{24}$/.test(id) ? { dataset_id: id } : {};
  };
  const actions: Record<string, string> = {
    '#catalog-shuffle, #catalog-reshuffle': 'catalog_shuffle', '#catalog-reset': 'catalog_reset',
    '#catalog-more, #catalog-next, #catalog-prev': 'catalog_more', '#hub-theme': 'appearance_change',
    '.dataset-open': 'dataset_open', '.dataset-info': 'dataset_metadata_open',
    '.dataset-metadata-links a': 'dataset_metadata_link', '[data-analytics-open]': 'dataset_open',
  };
  document.addEventListener('click', event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    for (const [selector, name] of Object.entries(actions)) {
      const target = event.target.closest(selector);
      if (target) { track(name, name.startsWith('dataset_') ? dataset(target) : {}); return; }
    }
  }, true);
  document.addEventListener('change', event => {
    const field = event.target;
    if (!event.isTrusted || !(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)
      || !field.closest('#individual-search')) return;
    if (field.name === 'q') track('catalog_search', {});
    else if (['dataset', 'licenseCategory', 'sort', 'kind', 'provider', 'license', 'status', 'photos', 'data', 'cameraModel'].includes(field.name)) {
      track('catalog_filter', { filter_name: field.name, filter_active: field.value !== '' });
    }
  });
  document.addEventListener('submit', event => {
    if (event.isTrusted && event.target instanceof HTMLFormElement && event.target.id === 'individual-search') track('catalog_search_submit', {});
  });
  let scrolled = false;
  let pending = false;
  window.addEventListener('scroll', () => {
    if (scrolled || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const height = document.documentElement.scrollHeight;
      if (height > innerHeight && scrollY + innerHeight >= height * .9) {
        scrolled = true;
        track('scroll', { percent_scrolled: 90 });
      }
    });
  }, { passive: true });
}
