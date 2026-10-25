import { LOOPBACK_HOSTS, PREVIEW_HEIGHT, PREVIEW_WIDTH, SHARE_PATH, VIEWER_ORIGINS, waitText } from '../shared/model';
import type { CardRecord, ListedLink } from '../shared/model';
import { escapeHtml } from '../shared/html';
import { HUB_UI_VERSION } from '../shared/ui-version';
import { assetLine } from '../shared/asset-summary';
import { icon } from '../shared/icons';
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

const header = (path: string) => [
  '<header class="site-header">',
  `<a class="brand" href="${escapeHtml(path)}/datasets/">ColmapView <span>Hub</span></a>`,
  '<nav class="site-nav" aria-label="Main navigation">',
  `<a class="button icon-button" href="${escapeHtml(path)}/datasets/" aria-label="Datasets" title="Datasets">${icon('datasets')}</a>`,
  `<a class="button icon-button" href="${VIEWER}/" aria-label="Open viewer" title="Open viewer">${icon('viewer')}</a>`,
  '</nav>',
  '<button type="button" class="button icon-button hub-theme" id="hub-theme" aria-label="Appearance: Dark. Switch to Light." title="Appearance: Dark. Switch to Light." data-theme="dark" disabled>',
  ...(['dark', 'light', 'system'] as const).map(theme => `<span data-theme-icon="${theme}"${theme === 'dark' ? '' : ' hidden'}>${icon(theme)}</span>`),
  '</button>',
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
  publicCatalog ? '<section class="analytics-choice" id="analytics-choice" aria-label="Optional analytics" hidden>'
    + '<p>Allow cookieless Google Analytics to measure Hub visits? Google receives connection and browser information. '
    + '<a href="https://colmapview.opsiclear.com/privacy.html#hub-analytics">Privacy</a></p>'
    + '<div class="actions"><button type="button" class="button" id="analytics-allow">Allow analytics</button>'
    + '<button type="button" class="button" id="analytics-decline">Decline</button></div>'
    + '<p class="note" id="analytics-status" role="status"></p></section>' : '',
].join('');

/** Every Hub page: ColmapView's public-page frame, stylesheets and icon. */
export function page(location: HubLocation, title: string, body: string, metadata = '', publicCatalog = false): string {
  const asset = (file: string) => `${location.path}/${file}`;
  return [
    `<!doctype html><html lang="en" data-hub-path="${escapeHtml(location.path)}"${publicCatalog ? ' data-hub-public-catalog="true"' : ''}><head>`,
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow,noarchive">',
    `<title>${escapeHtml(title)} · ColmapView Hub</title>`,
    metadata,
    `<link rel="icon" href="${asset('favicon.ico')}">`,
    `<link rel="stylesheet" href="${asset('colmapview.css')}">`,
    `<script src="${asset('assets/theme.js')}?v=${HUB_UI_VERSION}"></script>`,
    `<link rel="stylesheet" href="${asset('styles.css')}?v=${HUB_UI_VERSION}">`,
    `<script type="module" src="${asset('assets/client.js')}?v=${HUB_UI_VERSION}"></script>`,
    '</head><body>',
    '<a class="skip-link" href="#main">Skip to content</a>',
    header(location.path),
    `<main id="main" tabindex="-1"><div class="hub-content">${body}</div></main>`,
    footer(publicCatalog),
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
    `<meta property="og:image:width" content="${PREVIEW_WIDTH}">`,
    `<meta property="og:image:height" content="${PREVIEW_HEIGHT}">`,
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
