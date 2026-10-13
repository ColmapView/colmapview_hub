import { PREVIEW_HEIGHT, PREVIEW_WIDTH } from '../shared/model';
import type { AssetSummary, ListedLink, LinkRecord } from '../shared/model';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function assetSummaryText(assets: AssetSummary, modelStats = false): string {
  const quantity = (count: number, singular: string, plural = `${singular}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
  return [assets.format === 'zip' ? 'ZIP' : 'Folder',
    assets.colmap.files ? `${quantity(assets.colmap.files, 'COLMAP file')}${modelStats ? ` (${quantity(assets.colmap.cameras, 'camera')}, ${quantity(assets.colmap.points, 'point')})` : ''}` : '',
    assets.images ? `${quantity(assets.images, 'image')}${assets.imageFormat === 'jpeg' ? ' (JPEG)' : ''}` : '',
    assets.masks ? quantity(assets.masks, 'mask') : '', assets.splats ? quantity(assets.splats, 'Gaussian splat') : '',
    assets.viewerSettings ? 'Viewer settings' : '', assets.preview ? 'Cover image' : '',
  ].filter(Boolean).join(' · ');
}

export interface HubLocation {
  origin: string;
  path: string;
  base: string;
}

export function hubLocation(env: Env): HubLocation {
  const origin = new URL(env.HUB_ORIGIN);
  const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid Hub origin');
  const path = env.HUB_PATH;
  if (path !== '' && (!/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]+$/.test(path))) throw new Error('Invalid Hub path');
  return { origin: origin.origin, path, base: origin.origin + path };
}

function document(location: HubLocation, title: string, body: string, metadata = ''): string {
  return `<!doctype html><html lang="en" data-hub-path="${escapeHtml(location.path)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ColmapView Hub</title><meta name="robots" content="noindex,nofollow,noarchive">${metadata}<link rel="stylesheet" href="${location.path}/styles.css"><script type="module" src="${location.path}/assets/client.js"></script></head><body><header><a href="${location.path}/">ColmapView Hub</a><a href="https://colmapview.opsiclear.com/" rel="noreferrer">Viewer</a></header><main>${body}</main></body></html>`;
}

export function galleryPage(location: HubLocation, page: { links: ListedLink[]; cursor?: string }): string {
  const cards = page.links.map(link => `<a class="gallery-card" href="${location.path}/${link.id}"><img src="${location.path}/${link.id}/preview.jpg" width="600" height="315" loading="lazy" alt="${escapeHtml(link.title)}"><span>${escapeHtml(link.title)}</span>${link.assets ? `<span class="asset-summary">${escapeHtml(assetSummaryText(link.assets))}</span>` : ''}</a>`).join('');
  const next = page.cursor ? `<p><a class="button" href="${location.path}/?cursor=${encodeURIComponent(page.cursor)}">More results</a></p>` : '';
  return document(location, 'Shared results', `<h1>Shared results</h1><p>Results listed by their creators. Public uploads receive short links in ColmapView.</p>${cards ? `<div class="gallery">${cards}</div>${next}` : '<p>No results listed yet.</p>'}<p><a href="https://colmapview.opsiclear.com/" class="button" rel="noreferrer">Open ColmapView</a></p>`);
}

export function cardPage(location: HubLocation, record: LinkRecord): string {
  const pageUrl = `${location.base}/${record.id}`;
  const imageUrl = `${pageUrl}/preview.jpg`;
  const assets = record.assets ? assetSummaryText(record.assets, true) : '';
  const description = [record.description, assets].filter(Boolean).join(' · ') || 'Explore this reconstruction in ColmapView.';
  const metadata = `<link rel="canonical" href="${pageUrl}"><meta property="og:type" content="website"><meta property="og:url" content="${pageUrl}"><meta property="og:title" content="${escapeHtml(record.title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:image" content="${imageUrl}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="${PREVIEW_WIDTH}"><meta property="og:image:height" content="${PREVIEW_HEIGHT}"><meta property="og:image:alt" content="${escapeHtml(record.title)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(record.title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${imageUrl}"><meta name="twitter:image:alt" content="${escapeHtml(record.title)}">`;
  const licenseLabel = record.license?.name || record.license?.id || 'License';
  const license = record.license ? `<p>License: ${record.license.url ? `<a href="${escapeHtml(record.license.url)}" rel="noreferrer">${escapeHtml(licenseLabel)}</a>` : escapeHtml(licenseLabel)}</p>` : '';
  return document(location, record.title, `<h1>${escapeHtml(record.title)}</h1>${record.description ? `<p>${escapeHtml(record.description)}</p>` : ''}${assets ? `<p class="asset-summary" aria-label="Dataset assets">${escapeHtml(assets)}</p>` : ''}<div class="player" id="player"><img src="${imageUrl}" width="600" height="315" alt="${escapeHtml(record.title)}"><button id="play" data-viewer-url="${escapeHtml(record.viewerUrl)}">Play 3D</button></div><p><a href="${escapeHtml(record.viewerUrl)}" rel="noreferrer" target="_blank">Open in viewer</a></p>${license}`, metadata);
}

export function managementPage(location: HubLocation): string {
  return document(location, 'Manage link', '<h1>Manage link</h1><p>Delete this Hub link, its metadata, and its thumbnail. The source dataset stays in its storage.</p><form id="delete-link"><label class="acknowledgment"><input name="confirmDelete" type="checkbox" required><span>Delete this link.</span></label><button type="submit" class="danger">Delete link</button><p id="status" role="status" aria-live="polite"></p></form>');
}

export function errorPage(location: HubLocation, message: string): string {
  return document(location, message, `<h1>${escapeHtml(message)}</h1><p><a href="${location.path}/">ColmapView Hub</a></p>`);
}
