import { LOOPBACK_HOSTS, PREVIEW_HEIGHT, PREVIEW_WIDTH, SHARE_PATH, VIEWER_ORIGINS, waitText } from '../shared/model';
import type { CardRecord, ListedLink } from '../shared/model';
import { escapeHtml } from '../shared/html';
import { HUB_UI_VERSION } from '../shared/ui-version';
import { ANALYTICS_CONSENT_REVISION } from '../shared/analytics-consent';
import { assetLine } from '../shared/asset-summary';
import { icon } from '../shared/icons';
import { hubAssetUrl, hubViewerLink, viewerHome } from '../shared/viewer-host';
import type { ViewerHost, HubFrontend } from '../shared/viewer-host';
export { assetLine } from '../shared/asset-summary';
export { escapeHtml } from '../shared/html';

/** ColmapView's own pages; the Hub shares their header and footer. */
const VIEWER = VIEWER_ORIGINS[0];

export interface HubLocation {
  origin: string;
  path: string;
  base: string;
  /** True when the Hub itself runs on loopback, for local development. */
  local: boolean;
  viewerHost?: ViewerHost;
  frontend?: HubFrontend;
}

export function hubLocation(env: Env): HubLocation {
  const origin = new URL(env.HUB_ORIGIN);
  const local = origin.protocol === 'http:' && LOOPBACK_HOSTS.includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid Hub origin');
  const path = env.HUB_PATH;
  if (path !== '' && (!/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]+$/.test(path))) throw new Error('Invalid Hub path');
  return { origin: origin.origin, path, base: origin.origin + path, local };
}

/** The policy pages both the header and the footer link to. */
const policyLinks = ([['About', 'about.html'], ['Privacy', 'privacy.html'], ['Terms', 'terms.html']] as const)
  .map(([label, path]) => `<a href="${VIEWER}/${path}">${label}</a>`).join('');

const themeControl = () => [
  '<button type="button" class="button icon-button hub-theme" id="hub-theme" aria-label="Appearance: Dark. Switch to Light." title="Appearance: Dark. Switch to Light." data-theme="dark" disabled>',
  ...(['dark', 'light', 'system'] as const).map(theme => `<span data-theme-icon="${theme}"${theme === 'dark' ? '' : ' hidden'}>${icon(theme)}</span>`),
  '</button>',
].join('');

const viewerControl = (host?: ViewerHost) => `<a class="button icon-button" href="${viewerHome(host)}" aria-label="Open viewer" title="Open viewer">${icon('viewer')}</a>`;

const header = (path: string, filters?: string, host?: ViewerHost) => [
  `<header class="site-header${filters ? ' catalog-toolbar' : ''}">`,
  `<a class="brand" href="${escapeHtml(hubViewerLink(path + '/datasets/', host))}" aria-label="ColmapView Hub"><span class="brand-name">ColmapView</span> <span class="brand-section">Hub</span></a>`,
  ...(filters ? [filters] : [
  '<nav class="site-nav" aria-label="Main navigation">',
  `<a class="button icon-button" href="${escapeHtml(hubViewerLink(path + '/datasets/', host))}" aria-label="Datasets" title="Datasets">${icon('datasets')}</a>`,
  viewerControl(host),
  '</nav>',
  themeControl(),
  ]),
  '</header>',
].join('');

const footer = (publicCatalog: boolean) => [
  '<footer class="site-footer">',
  '<p>Built with ColmapView by OpsiClear</p>',
  '<nav class="footer-links" aria-label="Footer navigation">',
  policyLinks,
  '<a href="https://github.com/ColmapView/colmapview_hub">Source</a>',
  '<a href="mailto:info@opsiclear.com">Contact</a>',
  publicCatalog ? '<button type="button" id="analytics-settings" aria-controls="analytics-choice" aria-expanded="false" hidden>Analytics settings</button>' : '',
  '</nav></footer>',
  publicCatalog ? `<section class="analytics-choice" id="analytics-choice" data-analytics-consent-version="${ANALYTICS_CONSENT_REVISION}" aria-label="Optional analytics" hidden>`
    + `<button type="button" class="button icon-button analytics-close" id="analytics-close" aria-label="Close analytics settings" title="Close analytics settings">${icon('close')}</button>`
    + '<h2>Help improve ColmapView</h2>'
    + '<p id="analytics-purpose">Allow Google Analytics cookies to measure visits and Hub actions? '
    + 'Google receives cookie IDs, IP and browser/device details, but no dataset files.</p>'
    + '<p class="analytics-detail">Ads stay off. Change your choice anytime in Analytics settings. '
    + '<a href="https://colmapview.opsiclear.com/privacy.html#hub-analytics">Privacy policy</a></p>'
    + '<div class="actions"><button type="button" class="button button-primary" id="analytics-allow" aria-describedby="analytics-purpose analytics-status">Allow analytics</button>'
    + '<button type="button" class="button" id="analytics-decline" aria-describedby="analytics-purpose">No thanks</button></div>'
    + '<p class="note" id="analytics-status" role="status"></p></section>' : '',
].join('');

/** Every Hub page: ColmapView's public-page frame, stylesheets and icon. */
export function page(location: HubLocation, title: string, body: string, metadata = '', publicCatalog = false,
  catalog?: { filters: string; status: string }): string {
  const asset = (file: string) => hubAssetUrl(`${location.path}/${file}`, location.frontend);
  const anonymous = location.frontend ? ' crossorigin="anonymous"' : '';
  return [
    `<!doctype html><html lang="en" data-hub-path="${escapeHtml(location.path)}"${location.frontend ? ' data-hub-frontend="github"' : ''}${publicCatalog ? ' data-hub-public-catalog="true"' : ''}><head>`,
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    ...(location.frontend ? [
      '<meta name="referrer" content="no-referrer">',
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src https://colmapview.opsiclear.com https://www.googletagmanager.com; style-src https://colmapview.opsiclear.com; img-src https://colmapview.opsiclear.com https://www.googletagmanager.com https://*.google-analytics.com data:; font-src https://colmapview.opsiclear.com; connect-src https://colmapview.opsiclear.com https://www.googletagmanager.com https://*.google-analytics.com; base-uri \'none\'; form-action \'self\'">',
    ] : []),
    '<meta name="robots" content="noindex,nofollow,noarchive">',
    `<title>${escapeHtml(title)} · ColmapView Hub</title>`,
    metadata,
    `<link rel="icon" href="${asset('favicon.ico')}">`,
    `<link rel="stylesheet" href="${asset('colmapview.css')}"${anonymous}>`,
    `<script src="${asset('assets/theme.js')}?v=${HUB_UI_VERSION}"${anonymous}></script>`,
    `<link rel="stylesheet" href="${asset('styles.css')}?v=${HUB_UI_VERSION}"${anonymous}>`,
    `<script type="module" src="${asset('assets/client.js')}?v=${HUB_UI_VERSION}"${anonymous}></script>`,
    `</head><body${catalog ? ' class="catalog-browse"' : ''}>`,
    '<a class="skip-link" href="#main">Skip to content</a>',
    header(location.path, catalog?.filters, location.viewerHost),
    `<main id="main" tabindex="-1"><div class="hub-content">${body}</div></main>`,
    ...(location.frontend ? ['<noscript><p>This gallery needs JavaScript. <a href="https://colmapview.opsiclear.com/hub/datasets/?viewerHost=github">Browse the server-rendered catalog</a>.</p></noscript>'] : []),
    footer(publicCatalog),
    catalog ? `<section class="catalog-footbar" aria-label="Catalog status">${catalog.status}${viewerControl(location.viewerHost)}${themeControl()}</section>` : '',
    '</body></html>',
  ].join('');
}

/** Eyebrow, heading and lede, as on ColmapView's public pages. */
export function intro(heading: string, lede = '', extra = ''): string {
  return `<div class="page-intro"><p class="eyebrow">ColmapView Hub</p><h1>${escapeHtml(heading)}</h1>`
    + `${lede ? `<p class="lede">${escapeHtml(lede)}</p>` : ''}${extra}</div>`;
}

function socialMetadata(pageUrl: string, title: string, description: string): string {
  const image = `${pageUrl}/preview.jpg`;
  const [safeTitle, safeDescription] = [escapeHtml(title), escapeHtml(description)];
  return [
    `<link rel="canonical" href="${pageUrl}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${pageUrl}">`,
    `<meta property="og:title" content="${safeTitle}">`,
    `<meta property="og:description" content="${safeDescription}">`,
    `<meta property="og:image" content="${image}">`,
    '<meta property="og:image:type" content="image/jpeg">',
    `<meta property="og:image:alt" content="${safeTitle}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${safeTitle}">`,
    `<meta name="twitter:description" content="${safeDescription}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<meta name="twitter:image:alt" content="${safeTitle}">`,
  ].join('');
}

export function cardPage(location: HubLocation, record: CardRecord): string {
  const pageUrl = `${location.origin}${SHARE_PATH}/${record.id}`;
  const assets = assetLine(record.assets);
  const licenseName = record.license?.name || record.license?.id;
  const license = licenseName ? `License: ${record.license?.url
    ? `<a href="${escapeHtml(record.license.url)}" rel="noreferrer">${escapeHtml(licenseName)}</a>` : escapeHtml(licenseName)}` : '';
  const meta = [escapeHtml(assets), license].filter(Boolean).join(' · ');
  const privateLink = record.access === 'private';
  // Signing in inside an iframe is unreliable, so private cards open the viewer instead of playing inline.
  const player = `<div class="player" id="player"><img src="${pageUrl}/preview.jpg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" alt="${escapeHtml(record.title)}">`
    + (privateLink ? '' : `<button type="button" class="button button-primary" id="play" data-viewer-url="${escapeHtml(record.viewerUrl)}">Play 3D</button>`)
    + '</div>';
  const actions = '<div class="actions">'
    + `<a class="button" href="${escapeHtml(record.viewerUrl)}" target="_blank" rel="noopener noreferrer">Open in ColmapView<span aria-hidden="true"> ↗</span></a>`
    + (privateLink ? '<p class="note">Viewers need access to open this dataset.</p>' : '')
    + '</div>';
  return page(location, record.title, intro(record.title, record.description, meta ? `<p class="meta">${meta}</p>` : '') + player + actions,
    socialMetadata(pageUrl, record.title, record.description || assets || 'Explore this reconstruction in ColmapView.'));
}

export function managementPage(location: HubLocation, record: CardRecord): string {
  return page(location, 'Delete Hub link', intro(`Delete Hub link “${record.title}”?`, 'The dataset stays where it is.')
    + `<img class="thumbnail" src="${location.base}/${record.id}/preview.jpg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" alt="">`
    + '<form id="delete-link" class="actions"><button type="submit" class="button button-danger">Delete permanently</button></form>'
    + '<p id="status" class="status" role="status" tabindex="-1"></p>');
}

export function galleryPage(location: HubLocation, { links, cursor }: { links: ListedLink[]; cursor?: string }): string {
  const cards = links.map(link => {
    const assets = assetLine(link.assets);
    return `<a class="card gallery-card" href="${SHARE_PATH}/${link.id}">`
      + `<img src="${location.path}/${link.id}/preview.jpg" width="${PREVIEW_WIDTH}" height="${PREVIEW_HEIGHT}" loading="lazy" alt="">`
      + `<span class="gallery-title">${escapeHtml(link.title)}</span>${assets ? `<span class="meta">${escapeHtml(assets)}</span>` : ''}</a>`;
  }).join('');
  // A page whose entries were all skipped as invalid still links onward.
  const more = cursor ? `<div class="actions"><a class="button" href="${location.path}/?cursor=${encodeURIComponent(cursor)}">More results</a></div>` : '';
  return page(location, 'Shared results', intro('Shared results', 'Results listed by their creators.')
    + (cards ? `<div class="cards">${cards}</div>` : cursor ? '' : '<p>No results listed yet.</p>') + more);
}

/** The Cache API key of a gallery page. Only the cursor picks a page, so any other query shares the first page's entry, which purges clear. */
export function galleryKey(location: HubLocation, cursor?: string): string {
  return `${location.base}/${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
}

export function notFoundPage(location: HubLocation): string {
  return page(location, 'Link not found', intro('Link not found', 'Check the address, or ask for a new link.'));
}

export function blockedPage(location: HubLocation, minutes: number): string {
  const wait = waitText(minutes);
  return page(location, wait, intro(wait, 'Too many missing links from your network.'));
}

export function unavailablePage(location: HubLocation): string {
  return page(location, 'ColmapView Hub is unavailable', intro('ColmapView Hub is unavailable', 'Try again in a few minutes.'));
}

export function errorPage(location: HubLocation, message: string): string {
  return page(location, 'Invalid request', intro('Invalid request', message));
}
