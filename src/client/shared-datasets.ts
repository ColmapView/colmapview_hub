import { ID_PATTERN, MAX_PREVIEW_BYTES, isListedId } from '../shared/model';
import { isSourceVerification, publicationSource, type SharedDataset, type SharedDatasetPage } from '../shared/publication';
import { classifyLicense, LICENSE_CATEGORY_LABELS } from '../shared/license-categories';
import { licenseTagLabel } from '../shared/license-tags';
import { assetLine } from '../shared/asset-summary';
import { sceneContentItems, type SceneContents } from '../shared/scene-contents';
import { hubViewerLink } from '../shared/viewer-host';
import type { ViewerHost } from '../shared/viewer-host';
import { catalogViewerHost, hubApiBase, hubFrontend } from './hosting';

// Keep these shapes in sync with src/shared/icons.ts.
const sharedIconShapes = {
  info: [
    { tag: 'circle', attributes: { cx: '12', cy: '12', r: '9' } },
    { tag: 'path', attributes: { d: 'M12 16v-4' } },
    { tag: 'circle', attributes: { cx: '12', cy: '8', r: '1', fill: 'currentColor', stroke: 'none' } },
  ],
  close: [{ tag: 'path', attributes: { d: 'm6 6 12 12M6 18 18 6' } }],
  external: [{ tag: 'path', attributes: { d: 'M15 3h6v6m0-6L10 14M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6' } }],
  copy: [
    { tag: 'rect', attributes: { x: '8', y: '8', width: '12', height: '13', rx: '2' } },
    { tag: 'path', attributes: { d: 'M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3' } },
  ],
} as const;

function sharedIcon(name: keyof typeof sharedIconShapes): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const { tag, attributes } of sharedIconShapes[name]) {
    const shape = document.createElementNS(namespace, tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, value);
    svg.append(shape);
  }
  return svg;
}

/** Safe DOM construction: all user-supplied metadata remains text, and links come from a checked record ID. */
function sharedCard(entry: SharedDataset, hubPath: string, host?: ViewerHost): HTMLElement {
  const article = document.createElement('article');
  article.className = 'card dataset-card';
  article.dataset.datasetCard = '';
  article.dataset.entryId = `shared-${entry.id}`;
  const title = document.createElement('h2');
  const link = document.createElement('a'); link.className = 'dataset-open'; link.href = hubViewerLink(`/s/${entry.id}`, host, hubFrontend()); link.textContent = entry.title;
  link.title = entry.title;
  link.setAttribute('aria-label', `Open in viewer: ${entry.title}`); title.append(link);
  const info = document.createElement('button'); info.type = 'button'; info.className = 'dataset-info icon-button'; info.title = 'Dataset information';
  info.append(sharedIcon('info'));
  info.setAttribute('aria-label', `Metadata for ${entry.title}`); info.setAttribute('aria-haspopup', 'dialog'); info.setAttribute('aria-expanded', 'false');
  info.setAttribute('aria-controls', `metadata-shared-${entry.id}`);
  const image = document.createElement('img'); image.src = entry.previewBase64 ? `data:image/jpeg;base64,${entry.previewBase64}` : `${hubPath}/${entry.id}/preview.jpg`; image.alt = ''; image.loading = 'lazy';
  image.width = 320; image.height = 168; image.className = 'shared-dataset-preview';
  const originalUrl = publicationSource(entry.viewerUrl);
  const panel = document.createElement('dialog'); panel.className = 'dataset-metadata'; panel.setAttribute('closedby', 'any'); panel.id = `metadata-shared-${entry.id}`;
  panel.setAttribute('aria-label', `Metadata for ${entry.title}`);
  const header = document.createElement('div'); header.className = 'dataset-metadata-header';
  const panelTitle = document.createElement('h2'); panelTitle.textContent = 'Dataset information';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'dataset-metadata-close icon-button';
  close.setAttribute('aria-label', 'Close'); close.title = 'Close'; close.append(sharedIcon('close'));
  header.append(panelTitle, close);
  const content = document.createElement('div'); content.className = 'dataset-metadata-content';
  const name = document.createElement('h3'); name.className = 'dataset-metadata-title'; name.textContent = entry.title;
  const description = document.createElement('p'); description.textContent = entry.description;
  const facts = document.createElement('dl');
  for (const [label, value] of [['License', entry.license?.name || entry.license?.id || 'Not specified'],
    ['License category', LICENSE_CATEGORY_LABELS[classifyLicense(entry.license?.id ?? '')]]]) {
    const row = document.createElement('div');
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = value;
    row.append(term, detail); facts.append(row);
  }
  const preview = document.createElement('div'); preview.className = 'dataset-card-preview';
  preview.append(image, info);
  const reported: SceneContents = {};
  if ((entry.assets?.images ?? 0) > 0) reported.images = { status: 'listed' };
  if ((entry.assets?.colmap.cameras ?? 0) > 0) reported.cameras = { status: 'listed' };
  if ((entry.assets?.colmap.points ?? 0) > 0) reported.point_cloud = { status: 'listed' };
  if ((entry.assets?.masks ?? 0) > 0) reported.masks = { status: 'listed' };
  if ((entry.assets?.splats ?? 0) > 0) reported.splats = { status: 'listed' };
  const tags = document.createElement('div'); tags.className = 'dataset-card-tags';
  const items = sceneContentItems(reported);
  if (items.length) {
    const list = document.createElement('ul');
    list.className = 'dataset-contents';
    list.setAttribute('aria-label', 'Available data');
    for (const { kind, status, title, label, suffix } of items) {
      const item = document.createElement('li');
      item.setAttribute('data-asset', kind);
      item.setAttribute('data-asset-status', status);
      item.setAttribute('title', title);
      item.textContent = label + suffix;
      list.append(item);
    }
    tags.append(list);
  }
  const licenseTag = document.createElement('span'); licenseTag.className = 'dataset-tag';
  const licenseCategory = classifyLicense(entry.license?.id ?? '');
  licenseTag.dataset.licenseCategory = licenseCategory;
  licenseTag.textContent = licenseTagLabel(entry.license?.name || entry.license?.id || '', licenseCategory);
  tags.append(licenseTag);
  const contents = document.createElement('p'); contents.className = 'note';
  contents.textContent = assetLine(entry.assets) ? `Reported contents: ${assetLine(entry.assets)}` : '';
  const proof = document.createElement('p'); proof.className = 'note';
  proof.textContent = entry.verification.method === 'hf_colmap_headers' ? 'Public access and COLMAP headers checked. Complete loading and all photos are not verified.'
    : entry.verification.method === 'catalog_manifest' ? 'Uses an existing curated catalog manifest.' : 'Public source and dataset format reviewed.';
  const checks = document.createElement('details'); checks.className = 'dataset-metadata-checks';
  const checkLabel = document.createElement('summary'); checkLabel.textContent = 'Verification details'; checks.append(checkLabel, proof);
  const source = document.createElement('a'); source.href = hubViewerLink(`/s/${entry.id}`, host, hubFrontend()); source.textContent = 'Open dataset'; source.className = 'button dataset-metadata-open';
  const original = document.createElement('a'); original.href = originalUrl.href;
  original.target = '_blank'; original.rel = 'noopener noreferrer'; original.textContent = 'Dataset source'; original.append(sharedIcon('external'));
  const links = document.createElement('div'); links.className = 'dataset-metadata-links dataset-metadata-actions';
  const primary = document.createElement('div'); primary.className = 'dataset-metadata-primary';
  const secondary = document.createElement('div'); secondary.className = 'dataset-metadata-secondary'; secondary.append(original);
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'icon-button'; copy.dataset.copyDatasetLink = `/s/${entry.id}`;
  copy.setAttribute('aria-label', 'Copy link'); copy.title = 'Copy link'; copy.append(sharedIcon('copy'));
  const copied = document.createElement('span'); copied.className = 'note'; copied.dataset.copyStatus = ''; copied.setAttribute('role', 'status');
  primary.append(source, copy, copied); links.append(primary, secondary);
  content.append(name, facts, description, ...(contents.textContent ? [contents] : []), checks); panel.append(header, content, links);
  const body = document.createElement('div'); body.className = 'dataset-card-body'; body.append(title, tags);
  article.append(preview, body, panel);
  return article;
}

export function initializeSharedDatasets(): void {
  const host = catalogViewerHost();
  const section = document.querySelector<HTMLElement>('#shared-datasets');
  if (!section) return;
  const grid = section.querySelector<HTMLElement>('.dataset-grid')!;
  const status = section.querySelector<HTMLElement>('[role="status"]')!;
  const more = section.querySelector<HTMLButtonElement>('button[data-shared-more]')!;
  const hubPath = hubApiBase();
  let cursor: string | undefined;
  let loading = false;
  const seen = new Set<string>();
  const load = async () => {
    if (loading) return;
    loading = true; more.disabled = true; status.textContent = 'Loading shared datasets…';
    try {
      const query = new URLSearchParams(cursor ? { cursor } : {});
      if (hubFrontend()) query.set('preview', 'inline');
      const response = await fetch(`${hubPath}/api/publications${query.size ? `?${query}` : ''}`, { credentials: 'omit', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error();
      const data = await response.json() as SharedDatasetPage;
      if (!Array.isArray(data.entries) || data.entries.length > 12 || data.cursor !== undefined && (typeof data.cursor !== 'string' || data.cursor.length > 2048)
        || !data.entries.every(entry => entry && ID_PATTERN.test(entry.id) && isListedId(entry.id) && typeof entry.title === 'string' && typeof entry.description === 'string'
          && isSourceVerification(entry.verification)
          && (entry.previewBase64 === undefined || typeof entry.previewBase64 === 'string'
            && entry.previewBase64.length <= Math.ceil(MAX_PREVIEW_BYTES / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(entry.previewBase64)))) throw new Error();
      for (const entry of data.entries) {
        if (!seen.has(entry.id)) { grid.append(sharedCard(entry, hubPath, host)); seen.add(entry.id); }
      }
      cursor = data.cursor; more.hidden = !cursor;
      section.hidden = !seen.size && !cursor;
      status.textContent = seen.size ? `${seen.size} shared ${seen.size === 1 ? 'dataset' : 'datasets'}` : 'No datasets shared yet.';
    } catch { section.hidden = false; status.textContent = 'Shared datasets could not be loaded. Try again.'; more.hidden = false; }
    finally { loading = false; more.disabled = false; }
  };
  more.addEventListener('click', () => { void load(); });
  void load();
}
