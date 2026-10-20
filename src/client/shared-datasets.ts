import { ID_PATTERN, isListedId } from '../shared/model';
import { isSourceVerification, publicationSource, type SharedDataset, type SharedDatasetPage } from '../shared/publication';
import { classifyLicense, LICENSE_CATEGORY_LABELS } from '../shared/license-categories';
import { assetLine } from '../shared/asset-summary';

/** Safe DOM construction: all user-supplied metadata remains text, and links come from a checked record ID. */
function sharedCard(entry: SharedDataset, hubPath: string): HTMLElement {
  const article = document.createElement('article');
  article.className = 'card dataset-card';
  article.dataset.datasetCard = '';
  article.dataset.entryId = `shared-${entry.id}`;
  const heading = document.createElement('div'); heading.className = 'dataset-card-heading';
  const headingText = document.createElement('div');
  const title = document.createElement('h2');
  const link = document.createElement('a'); link.className = 'dataset-open'; link.href = `/s/${entry.id}`; link.textContent = entry.title;
  link.setAttribute('aria-label', `Open in viewer: ${entry.title}`); title.append(link);
  const info = document.createElement('button'); info.type = 'button'; info.className = 'dataset-info'; info.textContent = 'i';
  info.setAttribute('aria-label', `Metadata for ${entry.title}`); info.setAttribute('aria-haspopup', 'dialog'); info.setAttribute('aria-expanded', 'false');
  info.setAttribute('aria-controls', `metadata-shared-${entry.id}`);
  const image = document.createElement('img'); image.src = `${hubPath}/${entry.id}/preview.jpg`; image.alt = ''; image.loading = 'lazy';
  image.width = 600; image.height = 315; image.className = 'shared-dataset-preview';
  const originalUrl = publicationSource(entry.viewerUrl);
  const label = document.createElement('p'); label.className = 'dataset-label'; label.textContent = originalUrl.hostname;
  headingText.append(title, label); heading.append(headingText, info);
  const panel = document.createElement('dialog'); panel.className = 'dataset-metadata'; panel.id = `metadata-shared-${entry.id}`;
  panel.setAttribute('aria-label', `Metadata for ${entry.title}`);
  const header = document.createElement('div'); header.className = 'dataset-metadata-header';
  const panelTitle = document.createElement('h2'); panelTitle.textContent = 'Dataset information';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'dataset-metadata-close'; close.textContent = 'Close';
  header.append(panelTitle, close);
  const content = document.createElement('div'); content.className = 'dataset-metadata-content';
  const name = document.createElement('p'); name.className = 'dataset-metadata-title'; name.textContent = entry.title;
  const description = document.createElement('p'); description.textContent = entry.description;
  const license = document.createElement('p'); license.textContent = `License: ${entry.license?.name || entry.license?.id || 'Not specified'}`;
  const category = document.createElement('p'); category.textContent = `License category: ${LICENSE_CATEGORY_LABELS[classifyLicense(entry.license?.id ?? '')]}`;
  const contents = document.createElement('p'); contents.className = 'note';
  contents.textContent = assetLine(entry.assets) ? `Reported contents: ${assetLine(entry.assets)}` : '';
  const proof = document.createElement('p'); proof.className = 'note';
  proof.textContent = entry.verification.method === 'hf_colmap_headers' ? 'Public access and COLMAP headers checked. Complete loading and all photos are not verified.'
    : entry.verification.method === 'catalog_manifest' ? 'Uses an existing curated catalog manifest.' : 'Public source and dataset format reviewed.';
  const source = document.createElement('a'); source.href = `/s/${entry.id}`; source.textContent = 'Open dataset';
  const original = document.createElement('a'); original.href = originalUrl.href;
  original.target = '_blank'; original.rel = 'noopener noreferrer'; original.textContent = 'Dataset source ↗';
  const links = document.createElement('div'); links.className = 'dataset-metadata-links'; links.append(source, original);
  content.append(name, description, license, category, ...(contents.textContent ? [contents] : []), proof, links); panel.append(header, content);
  article.append(heading, image, panel);
  return article;
}

export function initializeSharedDatasets(): void {
  const section = document.querySelector<HTMLElement>('#shared-datasets');
  if (!section) return;
  const grid = section.querySelector<HTMLElement>('.dataset-grid')!;
  const status = section.querySelector<HTMLElement>('[role="status"]')!;
  const more = section.querySelector<HTMLButtonElement>('button[data-shared-more]')!;
  const hubPath = document.documentElement.dataset.hubPath ?? '/hub';
  let cursor: string | undefined;
  let loading = false;
  const seen = new Set<string>();
  const load = async () => {
    if (loading) return;
    loading = true; more.disabled = true; status.textContent = 'Loading shared datasets…';
    try {
      const response = await fetch(`${hubPath}/api/publications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!response.ok) throw new Error();
      const data = await response.json() as SharedDatasetPage;
      if (!Array.isArray(data.entries) || data.entries.length > 12 || data.cursor !== undefined && (typeof data.cursor !== 'string' || data.cursor.length > 2048)
        || !data.entries.every(entry => entry && ID_PATTERN.test(entry.id) && isListedId(entry.id) && typeof entry.title === 'string' && typeof entry.description === 'string'
          && isSourceVerification(entry.verification))) throw new Error();
      for (const entry of data.entries) {
        if (!seen.has(entry.id)) { grid.append(sharedCard(entry, hubPath)); seen.add(entry.id); }
      }
      cursor = data.cursor; more.hidden = !cursor;
      section.hidden = !seen.size && !cursor;
      status.textContent = seen.size ? `${seen.size} shared ${seen.size === 1 ? 'dataset' : 'datasets'}` : 'No datasets shared yet.';
    } catch { status.textContent = 'Shared datasets could not be loaded. Try again.'; more.hidden = false; }
    finally { loading = false; more.disabled = false; }
  };
  more.onclick = () => { void load(); };
  void load();
}
