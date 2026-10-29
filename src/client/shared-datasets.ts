import { ID_PATTERN, MAX_PREVIEW_BYTES, isListedId } from '../shared/model';
import { isSourceVerification, publicationSource, type SharedDataset, type SharedDatasetPage } from '../shared/publication';
import { classifyLicense, LICENSE_CATEGORY_LABELS } from '../shared/license-categories';
import { licenseTagLabel } from '../shared/license-tags';
import { assetLine } from '../shared/asset-summary';
import { sceneContentsHtml, type SceneContents } from '../shared/scene-contents';
import { icon } from '../shared/icons';
import { hubViewerLink } from '../shared/viewer-host';
import type { ViewerHost } from '../shared/viewer-host';
import { catalogViewerHost, hubApiBase, hubFrontend } from './hosting';

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
  info.innerHTML = icon('info');
  info.setAttribute('aria-label', `Metadata for ${entry.title}`); info.setAttribute('aria-haspopup', 'dialog'); info.setAttribute('aria-expanded', 'false');
  info.setAttribute('aria-controls', `metadata-shared-${entry.id}`);
  const image = document.createElement('img'); image.src = entry.previewBase64 ? `data:image/jpeg;base64,${entry.previewBase64}` : `${hubPath}/${entry.id}/preview.jpg`; image.alt = ''; image.loading = 'lazy';
  image.width = 320; image.height = 168; image.className = 'shared-dataset-preview';
  const originalUrl = publicationSource(entry.viewerUrl);
  const panel = document.createElement('dialog'); panel.className = 'dataset-metadata'; panel.id = `metadata-shared-${entry.id}`;
  panel.setAttribute('aria-label', `Metadata for ${entry.title}`);
  const header = document.createElement('div'); header.className = 'dataset-metadata-header';
  const panelTitle = document.createElement('h2'); panelTitle.textContent = 'Dataset information';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'dataset-metadata-close icon-button';
  close.setAttribute('aria-label', 'Close'); close.title = 'Close'; close.innerHTML = icon('close');
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
  const tags = document.createElement('div'); tags.className = 'dataset-card-tags'; tags.setAttribute('aria-label', 'Dataset tags');
  // Only static labels from the reported types enter this HTML; user metadata stays textContent.
  tags.innerHTML = sceneContentsHtml(reported);
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
  original.target = '_blank'; original.rel = 'noopener noreferrer'; original.textContent = 'Dataset source'; original.insertAdjacentHTML('beforeend', icon('external'));
  const links = document.createElement('div'); links.className = 'dataset-metadata-links dataset-metadata-actions';
  const primary = document.createElement('div'); primary.className = 'dataset-metadata-primary';
  const secondary = document.createElement('div'); secondary.className = 'dataset-metadata-secondary'; secondary.append(original);
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'icon-button'; copy.dataset.copyDatasetLink = `/s/${entry.id}`;
  copy.setAttribute('aria-label', 'Copy link'); copy.title = 'Copy link'; copy.innerHTML = icon('copy');
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
      const response = await fetch(`${hubPath}/api/publications${query.size ? `?${query}` : ''}`, { credentials: 'omit' });
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
  more.onclick = () => { void load(); };
  void load();
}
