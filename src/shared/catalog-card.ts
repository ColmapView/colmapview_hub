import { accessLabel, catalogOpenUrl, datasetFilterValue, datasetPath, deliveryLabel, providerLabel } from './catalog';
import type { CatalogSummary } from './catalog';
import { escapeHtml as escape } from './html';
import { licenseCategory, LICENSE_CATEGORY_LABELS } from './license-categories';
import { photoLabel } from './scene-photos';
import { catalogCardTitle } from './catalog-title';
import { sceneContentsHtml, sceneDataText, sceneStatisticsHtml, sceneThumbnailHtml, sceneThumbnailCreditHtml } from './scene-contents';

export function catalogCardHtml(entry: CatalogSummary): string {
  const category = licenseCategory(entry);
  const canOpen = catalogOpenUrl(entry) !== datasetPath(entry);
  const action = canOpen ? entry.hasViewer ? 'Open in viewer' : 'Try in viewer · unchecked' : 'Source details';
  const metadataId = `metadata-${entry.id}`;
  const title = catalogCardTitle(entry);
  const preview = sceneThumbnailHtml(entry, true);
  const facts = [
    ['Dataset', entry.dataset?.title || entry.title], ['Type', entry.itemKind || entry.formats.join(' · ') || 'Collection'],
    ['Source', providerLabel(entry.provider)], ['License', entry.license], ['License category', LICENSE_CATEGORY_LABELS[category]],
    ['Access', accessLabel(entry.access)], ['Evidence', entry.statusLabel], ['Delivery', deliveryLabel(entry.delivery)],
    ...(entry.photoStatus ? [['Photographs', photoLabel(entry.photoStatus)]] : []),
    ...(entry.availableData ? [['Available data', sceneDataText(entry.availableData)]] : []),
    ...(entry.sceneStats ? [['Camera models', entry.sceneStats.cameraModels === null ? 'Unknown' : entry.sceneStats.cameraModels.toLocaleString('en-US')]] : []),
  ];
  return `<article class="card dataset-card" data-dataset-card data-entry-id="${escape(entry.id)}">`
    + preview
    + '<div class="dataset-card-heading"><div>'
    + `<h2><a class="dataset-open" href="${escape(catalogOpenUrl(entry))}" aria-label="${escape(`${action}: ${title}`)}">${escape(title)}</a></h2>`
    + `<p class="dataset-label">${escape(entry.dataset?.label || providerLabel(entry.provider))}</p></div>`
    + `<button type="button" class="dataset-info" aria-label="${escape(`Metadata for ${entry.title}`)}" aria-controls="${metadataId}" aria-expanded="false"><span aria-hidden="true">i</span></button></div>`
    + sceneContentsHtml(entry.availableData)
    + sceneStatisticsHtml(entry.sceneStats, true)
    + (!canOpen ? '<p class="dataset-link-note">Source only</p>' : !entry.hasViewer ? '<p class="dataset-link-note">Try · unchecked ↗</p>' : '')
    + `<div class="dataset-metadata" id="${metadataId}" role="region" aria-label="${escape(`Metadata for ${entry.title}`)}">`
    + `<p class="dataset-metadata-title">${escape(entry.title)}</p><dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd${label === 'Photographs' && entry.photoStatus ? ` data-photo-status="${escape(entry.photoStatus)}"` : label === 'Camera models' ? ' data-stat="cameraModels"' : ''}>${escape(value)}</dd></div>`).join('')}</dl>`
    + (preview ? `<p class="dataset-photo-credit">Photo: ${sceneThumbnailCreditHtml(entry.thumbnail!)} · Cropped</p>` : '')
    + `<p class="note">${escape(entry.description)}</p>`
    + `<div class="dataset-metadata-links"><a href="${datasetPath(entry)}">Full metadata</a>`
    + (entry.dataset ? `<a href="/hub/datasets/?dataset=${encodeURIComponent(datasetFilterValue(entry))}">Related scenes</a>` : '')
    + `${entry.testOrFixture ? '<span>Test / demo</span>' : ''}</div></div></article>`;
}
