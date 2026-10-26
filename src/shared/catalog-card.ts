import { accessLabel, catalogOpenUrl, datasetFilterValue, datasetPath, deliveryLabel, isCatalogSourceUrl, providerLabel } from './catalog';
import type { CatalogSummary } from './catalog';
import { escapeHtml as escape } from './html';
import { licenseCategory, LICENSE_CATEGORY_LABELS } from './license-categories';
import { photoLabel } from './scene-photos';
import { catalogCardTitle } from './catalog-title';
import { icon } from './icons';
import { datasetSharePath } from './dataset-share';
import { HUB_ORIGIN, hubViewerLink } from './viewer-host';
import type { ViewerHost, HubFrontend } from './viewer-host';
import { VIDEO_CAPTURE_LABELS } from './video-capture';
import { gaussianAvailabilityHtml, sceneContentsHtml, sceneDataText, sceneStatisticsHtml, sceneThumbnailHtml, sceneThumbnailCreditHtml, scenePlaceholderHtml } from './scene-contents';

export function catalogCardHtml(entry: CatalogSummary, host?: ViewerHost, frontend?: HubFrontend): string {
  const category = licenseCategory(entry);
  const canOpen = catalogOpenUrl(entry) !== datasetPath(entry);
  const action = canOpen ? entry.hasViewer ? 'Open in viewer' : 'Try in viewer · unchecked' : 'Source details';
  const metadataId = `metadata-${entry.id}`;
  const title = catalogCardTitle(entry);
  const preview = sceneThumbnailHtml(entry, true, frontend === 'github' ? HUB_ORIGIN : '');
  const share = datasetSharePath(entry.id, entry.shareName);
  const facts = [
    ['Dataset', entry.dataset?.title || entry.title], ['Type', entry.itemKind || entry.formats.join(' · ') || 'Collection'],
    ['Source', providerLabel(entry.provider)], ['License', entry.license], ['License category', LICENSE_CATEGORY_LABELS[category]],
    ['Access', accessLabel(entry.access)], ['Evidence', entry.statusLabel], ['Delivery', deliveryLabel(entry.delivery)],
    ...(entry.photoStatus ? [['Images', photoLabel(entry.photoStatus)]] : []),
    ...(entry.videoCapture ? [['Video capture', VIDEO_CAPTURE_LABELS[entry.videoCapture]]] : []),
    ...(entry.availableData ? [['Available data', sceneDataText(entry.availableData)]] : []),
  ];
  return `<article class="card dataset-card" data-dataset-card data-entry-id="${escape(entry.id)}">`
    + '<div class="dataset-card-preview">' + (preview || scenePlaceholderHtml(entry))
    + (entry.statusLabel === 'Feature links need review' || entry.statusLabel === 'Calibration needs review'
      ? `<p class="dataset-review">${escape(entry.statusLabel)}</p>` : '')
    + `<button type="button" class="dataset-info icon-button" aria-label="${escape(`Metadata for ${entry.title}`)}" title="Dataset information" aria-haspopup="dialog" aria-controls="${metadataId}" aria-expanded="false">${icon('info')}</button>`
    + `<div class="dataset-card-hover"><p class="dataset-label">${escape(entry.dataset?.label || providerLabel(entry.provider))}</p>` + sceneContentsHtml(entry.availableData)
    + (entry.videoCapture ? `<p>${escape(VIDEO_CAPTURE_LABELS[entry.videoCapture])}</p>` : '')
    + `<p>${escape(LICENSE_CATEGORY_LABELS[category])} · ${escape(entry.license)}</p></div></div>`
    + '<div class="dataset-card-body">'
    + `<h2><a class="dataset-open" href="${escape(hubViewerLink(share || catalogOpenUrl(entry), host, frontend))}" title="${escape(title)}" aria-label="${escape(`${action}: ${title}`)}">${escape(title)}</a></h2>`
    + gaussianAvailabilityHtml(entry.availableData)
    + (!canOpen ? '<p class="dataset-link-note">Source only</p>' : !entry.hasViewer ? '<p class="dataset-link-note">Try · unchecked ↗</p>' : '')
    + '</div>'
    + `<dialog class="dataset-metadata" id="${metadataId}" aria-label="${escape(`Metadata for ${entry.title}`)}">`
    + `<div class="dataset-metadata-header"><h2>Dataset information</h2><button type="button" class="dataset-metadata-close icon-button" aria-label="Close" title="Close" autofocus>${icon('close')}</button></div>`
    + '<div class="dataset-metadata-content">'
    + `<p class="dataset-metadata-title">${escape(entry.title)}</p>` + sceneStatisticsHtml(entry.sceneStats)
    + `<dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd${label === 'Images' && entry.photoStatus ? ` data-photo-status="${escape(entry.photoStatus)}"` : ''}>${escape(value)}</dd></div>`).join('')}</dl>`
    + (preview ? `<p class="dataset-photo-credit">${entry.thumbnail!.videoFrame ? 'Video frame' : 'Photo'}: ${sceneThumbnailCreditHtml(entry.thumbnail!)}${entry.thumbnail!.crop === 'center_square' ? ' · Cropped' : ''}</p>` : '')
    + `<p class="note">${escape(entry.description)}</p>`
    + `<div class="dataset-metadata-links"><a href="${escape(hubViewerLink(datasetPath(entry), host, frontend))}">Full metadata</a>`
    + (share ? `<button type="button" class="icon-button" data-copy-dataset-link="${share}" aria-label="Copy link" title="Copy link">${icon('copy')}</button><span class="note" data-copy-status role="status"></span>` : '')
    + (entry.dataset ? `<a href="${escape(hubViewerLink('/hub/datasets/?dataset=' + encodeURIComponent(datasetFilterValue(entry)), host))}">Related scenes</a>` : '')
    + (isCatalogSourceUrl(entry.sourceUrl) ? `<a href="${escape(entry.sourceUrl)}" target="_blank" rel="noopener noreferrer">Original source ↗</a>` : '')
    + `${entry.testOrFixture ? '<span>Test / demo</span>' : ''}</div></div></dialog></article>`;
}
