import { catalogCardHtml } from '../shared/catalog-card';
import type { CatalogSummary } from '../shared/catalog';
import { DATASET_SHARE_PATH, datasetShareId } from '../shared/dataset-share';
import { ID_PATTERN, SHARE_PATH } from '../shared/model';

export function catalogCardElement(entry: CatalogSummary): HTMLElement {
  const template = document.createElement('template');
  // The shared SSR renderer escapes every text/attribute and restricts load URLs.
  template.innerHTML = catalogCardHtml(entry);
  return template.content.firstElementChild as HTMLElement;
}

export function initializeCatalogMetadata(): void {
  const isPanel = (target: EventTarget | null): target is HTMLDialogElement =>
    target instanceof HTMLDialogElement && target.classList.contains('dataset-metadata');
  const outside = (panel: HTMLDialogElement, event: MouseEvent) => {
    const box = panel.getBoundingClientRect();
    return event.clientX < box.left || event.clientX >= box.right || event.clientY < box.top || event.clientY >= box.bottom;
  };
  let backdrop: HTMLDialogElement | null = null;
  // Require both the press and click on the backdrop, so dragging out of the
  // panel while selecting text does not dismiss it.
  document.addEventListener('pointerdown', event => {
    backdrop = isPanel(event.target) && outside(event.target, event) ? event.target : null;
  });
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const copy = target.closest<HTMLButtonElement>('[data-copy-dataset-link]');
    if (copy) {
      const path = copy.dataset.copyDatasetLink || '';
      if (!(path.startsWith(`${DATASET_SHARE_PATH}/`) && datasetShareId(path.slice(DATASET_SHARE_PATH.length + 1)))
        && !(path.startsWith(`${SHARE_PATH}/`) && ID_PATTERN.test(path.slice(SHARE_PATH.length + 1)))) return;
      const status = copy.parentElement?.querySelector<HTMLElement>('[data-copy-status]');
      const url = new URL(path, location.origin).href;
      copy.disabled = true;
      void Promise.resolve().then(() => navigator.clipboard.writeText(url)).then(() => {
        if (status) status.textContent = 'Link copied';
      }).catch(() => {
        if (status) {
          const link = document.createElement('a'); link.href = url; link.textContent = url;
          status.replaceChildren('Copy this link: ', link);
        }
      }).finally(() => { copy.disabled = false; });
      return;
    }
    const button = target.closest<HTMLButtonElement>('.dataset-info');
    if (button) {
      const panel = button.closest('[data-dataset-card]')?.querySelector<HTMLDialogElement>('.dataset-metadata');
      if (panel && !panel.open) {
        panel.showModal();
        panel.querySelector('.dataset-metadata-content')?.scrollTo(0, 0);
        button.setAttribute('aria-expanded', 'true');
      }
    } else if (target.closest('.dataset-metadata-close')) {
      target.closest<HTMLDialogElement>('.dataset-metadata')?.close();
    } else if (isPanel(target) && backdrop === target && outside(target, event)) {
      target.close();
    }
    backdrop = null;
  });
  // close does not bubble. Capture it for server-rendered and appended cards;
  // the native dialog also supplies Escape handling and modal keyboard focus.
  document.addEventListener('close', event => {
    if (!isPanel(event.target) || event.target.open) return;
    const button = event.target.closest('[data-dataset-card]')?.querySelector<HTMLButtonElement>('.dataset-info');
    button?.setAttribute('aria-expanded', 'false');
    button?.focus({ preventScroll: true });
  }, true);
}
