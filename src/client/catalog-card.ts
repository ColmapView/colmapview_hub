import { catalogCardHtml } from '../shared/catalog-card';
import type { CatalogSummary } from '../shared/catalog';

export function catalogCardElement(entry: CatalogSummary): HTMLElement {
  const template = document.createElement('template');
  // The shared SSR renderer escapes every text/attribute and restricts load URLs.
  template.innerHTML = catalogCardHtml(entry);
  return template.content.firstElementChild as HTMLElement;
}

export function initializeCatalogMetadata(): void {
  const cardFor = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-dataset-card]') : null;
  const show = (card: HTMLElement) => {
    if (card.dataset.metadataDismissed) return;
    const panel = card.querySelector<HTMLElement>('.dataset-metadata');
    if (!panel) return;
    card.dataset.metadataOpen = 'true';
    card.querySelector('.dataset-info')?.setAttribute('aria-expanded', 'true');
    const box = card.getBoundingClientRect();
    const height = panel.getBoundingClientRect().height;
    const above = Math.max(0, box.top - 12);
    const below = Math.max(0, innerHeight - box.bottom - 12);
    const flip = below < height && above > below;
    card.dataset.metadataSide = flip ? 'above' : 'below';
    panel.style.maxHeight = `${Math.min(400, Math.max(0, flip ? above : below))}px`;
  };
  const hide = (card: HTMLElement, dismiss = false) => {
    delete card.dataset.metadataOpen;
    if (dismiss) card.dataset.metadataDismissed = 'true';
    card.querySelector('.dataset-info')?.setAttribute('aria-expanded', 'false');
  };
  document.addEventListener('pointerover', event => {
    const card = cardFor(event.target);
    if (!card || event.pointerType === 'touch') return;
    if (!(event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) delete card.dataset.metadataDismissed;
    show(card);
  });
  document.addEventListener('pointerout', event => {
    const card = cardFor(event.target);
    if (card && !(event.relatedTarget instanceof Node && card.contains(event.relatedTarget))
      && !card.contains(document.activeElement) && !card.dataset.metadataPinned) hide(card);
  });
  document.addEventListener('focusin', event => {
    const card = cardFor(event.target);
    if (!card) return;
    if (!(event.relatedTarget instanceof Node && card.contains(event.relatedTarget))) delete card.dataset.metadataDismissed;
    show(card);
  });
  document.addEventListener('focusout', event => {
    const card = cardFor(event.target);
    if (card && !(event.relatedTarget instanceof Node && card.contains(event.relatedTarget)) && !card.dataset.metadataPinned) hide(card);
  });
  document.addEventListener('click', event => {
    const card = cardFor(event.target);
    const button = event.target instanceof Element ? event.target.closest('.dataset-info') : null;
    if (card && button) {
      if (card.dataset.metadataPinned) { delete card.dataset.metadataPinned; hide(card, true); }
      else { delete card.dataset.metadataDismissed; card.dataset.metadataPinned = 'true'; show(card); }
    }
    for (const other of document.querySelectorAll<HTMLElement>('[data-metadata-open]')) {
      if (other !== card) { delete other.dataset.metadataPinned; hide(other, true); }
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const card = cardFor(event.target) || document.querySelector<HTMLElement>('[data-metadata-open]');
    if (!card) return;
    event.preventDefault();
    if (event.target instanceof Node && card.querySelector('.dataset-metadata')?.contains(event.target)) card.querySelector<HTMLButtonElement>('.dataset-info')?.focus({ preventScroll: true });
    delete card.dataset.metadataPinned;
    hide(card, true);
  });
}
