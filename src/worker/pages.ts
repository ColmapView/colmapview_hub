import { LOOPBACK_HOSTS, PREVIEW_HEIGHT, PREVIEW_WIDTH, VIEWER_ORIGINS, waitText } from '../shared/model';
import type { AssetSummary, CardRecord, ListedLink } from '../shared/model';
import { escapeHtml } from '../shared/html';
export { escapeHtml } from '../shared/html';

/** ColmapView's own pages; the Hub shares their header and footer. */
const VIEWER = VIEWER_ORIGINS[0];

/** Nonzero counts only, for example "83 images · 83,749 points · 82 masks · 1 splat". */
export function assetLine(assets?: AssetSummary): string {
  if (!assets) return '';
  const count = (value: number, noun: string) => value ? `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}` : '';
  return [count(assets.images, 'image'), count(assets.colmap.points, 'point'), count(assets.masks, 'mask'), count(assets.splats, 'splat')]
    .filter(Boolean).join(' · ');
}

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
  `<a class="brand" href="${escapeHtml(path)}/">ColmapView <span>Hub</span></a>`,
  '<nav class="site-nav" aria-label="Main navigation">',
  `<a href="${escapeHtml(path)}/datasets/">Datasets</a>`,
  `<a href="${escapeHtml(path)}/datasets/collections">Collections</a>`,
  `<a href="${VIEWER}/">Open viewer</a>`,
  '</nav>',
  '<label class="hub-theme"><span class="sr-only">Appearance</span><select id="hub-theme" aria-label="Appearance" disabled><option value="dark">Dark</option><option value="light">Light</option><option value="system">System</option></select></label>',
  '</header>',
].join('');

const footer = [
  '<footer class="site-footer">',
  '<p>ColmapView · Maintained by OpsiClear LLC</p>',
  '<nav class="footer-links" aria-label="Footer navigation">',
  policyLinks,
  '<a href="mailto:info@opsiclear.com">Contact</a>',
  '</nav></footer>',
].join('');

/** Every Hub page: ColmapView's public-page frame, stylesheets and icon. */
export function page(location: HubLocation, title: string, body: string, metadata = ''): string {
  const asset = (file: string) => `${location.path}/${file}`;
  return [
    `<!doctype html><html lang="en" data-hub-path="${escapeHtml(location.path)}"><head>`,
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow,noarchive">',
    `<title>${escapeHtml(title)} · ColmapView Hub</title>`,
    metadata,
    `<link rel="icon" href="${asset('favicon.ico')}">`,
    `<link rel="stylesheet" href="${asset('colmapview.css')}">`,
    `<script src="${asset('assets/theme.js')}?v=scene-ui-10"></script>`,
    `<link rel="stylesheet" href="${asset('styles.css')}?v=scene-ui-10">`,
    `<script type="module" src="${asset('assets/client.js')}?v=scene-ui-10"></script>`,
    '</head><body>',
    '<a class="skip-link" href="#main">Skip to content</a>',
    header(location.path),
    `<main id="main" tabindex="-1"><div class="hub-content">${body}</div></main>`,
    footer,
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
  const pageUrl = `${location.base}/${record.id}`;
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
    return `<a class="card gallery-card" href="${location.path}/${link.id}">`
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

export function landingPage(location: HubLocation): string {
  return page(location, 'Datasets and shared results', '<div class="hub-landing">' + intro('Explore in ColmapView.', 'Find a model, check its source and open it in the viewer.',
    `<div class="actions"><a class="button button-primary" href="${location.path}/datasets/">Browse datasets</a><a class="button" href="${VIEWER}/">Open viewer</a></div>`)
    + '<section class="hub-landing-panels"><div class="card"><h2>Public datasets</h2><p>Named scene datasets with related files kept together. Filter by format and license.</p>'
    + `<a href="${location.path}/datasets/collections">Browse collections ↗</a></div><div class="card"><h2>Share a reconstruction</h2><p>Publish from ColmapView to create a Hub link for your result.</p>`
    + `<a href="${VIEWER}/">Open ColmapView ↗</a></div></section></div>`);
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
