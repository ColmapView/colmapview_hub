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
  const hide = (card: HTMLElement, dismiss = false) => {
    delete card.dataset.metadataOpen;
    if (dismiss) card.dataset.metadataDismissed = 'true';
    card.querySelector('.dataset-info')?.setAttribute('aria-expanded', 'false');
  };
  const position = (card: HTMLElement) => {
    const panel = card.querySelector<HTMLElement>('.dataset-metadata');
    if (!panel) return;
    const box = card.getBoundingClientRect();
    const top = visualViewport?.offsetTop || 0;
    const bottom = top + (visualViewport?.height || innerHeight);
    if (box.bottom <= top || box.top >= bottom) {
      if (panel.contains(document.activeElement)) card.querySelector<HTMLButtonElement>('.dataset-info')?.focus({ preventScroll: true });
      delete card.dataset.metadataPinned;
      hide(card, true);
      return;
    }
    // Measure the content rather than the previous viewport's height limit.
    const height = Math.min(400, panel.scrollHeight + 2);
    const above = Math.max(0, box.top - top - 12);
    const below = Math.max(0, bottom - box.bottom - 12);
    const flip = below < height && above > below;
    card.dataset.metadataSide = flip ? 'above' : 'below';
    panel.style.maxHeight = `${Math.min(400, Math.max(0, flip ? above : below))}px`;
  };
  const show = (card: HTMLElement) => {
    if (card.dataset.metadataDismissed) return;
    card.dataset.metadataOpen = 'true';
    card.querySelector('.dataset-info')?.setAttribute('aria-expanded', 'true');
    position(card);
  };
  let positioning = false;
  const reposition = () => {
    if (positioning) return;
    positioning = true;
    requestAnimationFrame(() => {
      positioning = false;
      for (const card of document.querySelectorAll<HTMLElement>('[data-metadata-open]')) position(card);
    });
  };
  addEventListener('resize', reposition, { passive: true });
  visualViewport?.addEventListener('resize', reposition, { passive: true });
  visualViewport?.addEventListener('scroll', reposition, { passive: true });
  document.addEventListener('scroll', event => {
    if (!(event.target instanceof Element && event.target.closest('.dataset-metadata'))) reposition();
  }, { capture: true, passive: true });
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
