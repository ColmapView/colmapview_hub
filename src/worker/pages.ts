import { PREVIEW_HEIGHT, PREVIEW_WIDTH, UNLISTED_NOTICE } from '../shared/model';
import type { LinkRecord } from '../shared/model';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export interface HubLocation {
  origin: string;
  path: string;
  base: string;
  local: boolean;
}

export function hubLocation(env: Env): HubLocation {
  const origin = new URL(env.HUB_ORIGIN);
  const local = origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname);
  if ((!local && origin.protocol !== 'https:') || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid Hub origin');
  const path = env.HUB_PATH;
  if (path !== '' && (!/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]+$/.test(path))) throw new Error('Invalid Hub path');
  return { origin: origin.origin, path, base: origin.origin + path, local };
}

function document(location: HubLocation, title: string, body: string, metadata = '', verificationKey?: string): string {
  const key = verificationKey ? ` data-site-key="${escapeHtml(verificationKey)}"` : '';
  return `<!doctype html><html lang="en" data-hub-path="${escapeHtml(location.path)}"${key}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · ColmapView Hub</title><meta name="robots" content="noindex,nofollow,noarchive">${metadata}<link rel="stylesheet" href="${location.path}/styles.css"><script type="module" src="${location.path}/assets/client.js"></script></head><body><header><a href="${location.path}/">ColmapView Hub</a><a href="https://colmapview.opsiclear.com/" rel="noreferrer">Viewer</a></header><main>${body}</main></body></html>`;
}

export function createPage(location: HubLocation, key: string): string {
  return document(location, 'Create a link', `<h1>Create a link</h1><form id="create-link">
    <label>Viewer link<input name="viewerUrl" type="url" required maxlength="32768" placeholder="https://colmapview.opsiclear.com/?url=…"></label>
    <label>Title<input name="title" required maxlength="120" autocomplete="off"></label>
    <label>Description <span>(optional)</span><textarea name="description" rows="2" maxlength="280"></textarea></label>
    <label>Preview image<input name="preview" type="file" accept="image/png,image/jpeg,image/webp" required></label>
    <img id="draft-preview" width="600" height="315" alt="Prepared card preview" hidden>
    <details><summary>License (optional)</summary><label>Name or ID<input name="licenseName" maxlength="160" autocomplete="off"></label><label>License link<input name="licenseUrl" type="url" maxlength="2048" placeholder="https://…"></label></details>
    <label class="acknowledgment"><input name="publicAcknowledged" type="checkbox" required><span>${UNLISTED_NOTICE} Dataset storage permissions still apply.</span></label>
    <div id="verification"></div><button type="submit"${key ? '' : ' disabled'}>Create link</button>
  </form><section id="result" hidden><h2>Your link</h2><a id="public-link" rel="noreferrer"></a><div class="actions"><button id="copy-link">Copy link</button><a id="open-link" class="button" rel="noreferrer">Open</a></div><p>Save the management link to remove this link later. Keep it private.</p><div class="actions"><button id="copy-management">Copy management link</button><button id="new-link">Create another</button></div></section><p id="status" role="status" aria-live="polite">${key ? '' : 'Link creation is not available yet.'}</p>`, '', key);
}

export function cardPage(location: HubLocation, record: LinkRecord): string {
  const pageUrl = `${location.base}/${record.id}`;
  const imageUrl = `${pageUrl}/preview.jpg`;
  const description = record.description || 'Explore this reconstruction in ColmapView.';
  const metadata = `<link rel="canonical" href="${pageUrl}"><meta property="og:type" content="website"><meta property="og:url" content="${pageUrl}"><meta property="og:title" content="${escapeHtml(record.title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:image" content="${imageUrl}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="${PREVIEW_WIDTH}"><meta property="og:image:height" content="${PREVIEW_HEIGHT}"><meta property="og:image:alt" content="${escapeHtml(record.title)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(record.title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${imageUrl}"><meta name="twitter:image:alt" content="${escapeHtml(record.title)}">`;
  const licenseLabel = record.license?.name || record.license?.id || 'License';
  const license = record.license ? `<p>License: ${record.license.url ? `<a href="${escapeHtml(record.license.url)}" rel="noreferrer">${escapeHtml(licenseLabel)}</a>` : escapeHtml(licenseLabel)}</p>` : '';
  return document(location, record.title, `<h1>${escapeHtml(record.title)}</h1>${record.description ? `<p>${escapeHtml(record.description)}</p>` : ''}<div class="player" id="player"><img src="${imageUrl}" width="600" height="315" alt="${escapeHtml(record.title)}"><button id="play" data-viewer-url="${escapeHtml(record.viewerUrl)}">Play 3D</button></div><p><a href="${escapeHtml(record.viewerUrl)}" rel="noreferrer" target="_blank">Open in viewer</a></p>${license}`, metadata);
}

export function managementPage(location: HubLocation): string {
  return document(location, 'Manage link', '<h1>Manage link</h1><p>Delete this Hub link, its metadata, and its thumbnail. The source dataset stays in its storage.</p><form id="delete-link"><label class="acknowledgment"><input name="confirmDelete" type="checkbox" required><span>Delete this link.</span></label><button type="submit" class="danger">Delete link</button><p id="status" role="status" aria-live="polite"></p></form>');
}

export function errorPage(location: HubLocation, message: string): string {
  return document(location, message, `<h1>${escapeHtml(message)}</h1><p><a href="${location.path}/">ColmapView Hub</a></p>`);
}
