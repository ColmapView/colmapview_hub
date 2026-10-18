import { accessLabel, catalogOpenUrl, datasetFilterValue, datasetPath, deliveryLabel, providerLabel } from './catalog';
import type { CatalogSummary } from './catalog';
import { escapeHtml as escape } from './html';
import { licenseCategory, LICENSE_CATEGORY_LABELS } from './license-categories';
import { photoLabel } from './scene-photos';
import { sceneContentsHtml, sceneDataText, sceneStatisticsHtml, sceneThumbnailHtml } from './scene-contents';

export function catalogCardHtml(entry: CatalogSummary): string {
  const category = licenseCategory(entry);
  const shortLicense = { commercial: 'Commercial', 'non-commercial': 'NC', 'not-specified': 'Unspecified' }[category];
  const canOpen = catalogOpenUrl(entry) !== datasetPath(entry);
  const action = canOpen ? entry.hasViewer ? 'Open in viewer' : 'Try in viewer · unchecked' : 'Source details';
  const metadataId = `metadata-${entry.id}`;
  const facts = [
    ['Dataset', entry.dataset?.title || entry.title], ['Type', entry.itemKind || entry.formats.join(' · ') || 'Collection'],
    ['Source', providerLabel(entry.provider)], ['License', entry.license], ['License category', LICENSE_CATEGORY_LABELS[category]],
    ['Access', accessLabel(entry.access)], ['Evidence', entry.statusLabel], ['Delivery', deliveryLabel(entry.delivery)],
    ...(entry.photoStatus ? [['Photographs', photoLabel(entry.photoStatus)]] : []),
    ...(entry.availableData ? [['Available data', sceneDataText(entry.availableData)]] : []),
  ];
  return `<article class="card dataset-card" data-dataset-card data-entry-id="${escape(entry.id)}">`
    + `<p class="dataset-label">${escape(entry.dataset?.label || providerLabel(entry.provider))}</p>`
    + sceneThumbnailHtml(entry)
    + `<h2><a class="dataset-open" href="${escape(catalogOpenUrl(entry))}" aria-label="${escape(`${action}: ${entry.title}`)}">${escape(entry.title)}</a></h2>`
    + sceneContentsHtml(entry.availableData)
    + sceneStatisticsHtml(entry.sceneStats)
    + (entry.photoStatus ? `<p class="dataset-photo-status" data-photo-status="${escape(entry.photoStatus)}">${escape(photoLabel(entry.photoStatus))}</p>` : '')
    + `<p class="dataset-card-footer"><span class="dataset-license-category" title="${LICENSE_CATEGORY_LABELS[category]}">${shortLicense}</span>`
    + `<span class="dataset-open-label">${canOpen ? entry.hasViewer ? 'Open ↗' : 'Try · unchecked ↗' : 'Source only'}</span></p>`
    + `<button type="button" class="dataset-info" aria-label="${escape(`Metadata for ${entry.title}`)}" aria-controls="${metadataId}" aria-expanded="false"><span aria-hidden="true">i</span></button>`
    + `<div class="dataset-metadata" id="${metadataId}" role="region" aria-label="${escape(`Metadata for ${entry.title}`)}">`
    + `<p class="dataset-metadata-title">${escape(entry.title)}</p><dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>`
    + `<p class="note">${escape(entry.description)}</p>`
    + `<div class="dataset-metadata-links"><a href="${datasetPath(entry)}">Full metadata</a>`
    + (entry.dataset ? `<a href="/hub/datasets/?dataset=${encodeURIComponent(datasetFilterValue(entry))}">Related scenes</a>` : '')
    + `${entry.testOrFixture ? '<span>Test / demo</span>' : ''}</div></div></article>`;
}
