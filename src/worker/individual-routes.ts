import { catalogEntryPage, catalogEntryContent } from './catalog-pages';
import { individualFilters, individualIndex, readIndividual, searchIndividuals } from './individual-data';
import { individualIndexPage } from './individual-pages';
import { errorPage } from './pages';
import type { HubLocation } from './pages';
import { individualSelection } from '../shared/individual-catalog';
import { isCatalogOpenUrl, datasetPath } from '../shared/catalog';
import { HUB_UI_VERSION } from '../shared/ui-version';
import { defaultFeedSeed } from '../shared/discovery';
import { preferredViewerUrl } from '../shared/viewer-host';

const REVALIDATE = 'public, no-cache, must-revalidate, no-transform';
const respond = (request: Request, response: Response, freshFeed = false) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', freshFeed ? 'no-store' : REVALIDATE);
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  return new Response(request.headers.get('If-None-Match') === headers.get('ETag') ? null : response.body, {
    status: request.headers.get('If-None-Match') === headers.get('ETag') ? 304 : response.status, headers,
  });
};

/** A public, operator-built metadata namespace. No user-created share record,
 * management secret, user-record listing, or private lookup path is reachable here. */
export async function individualRoute(request: Request, env: Env, ctx: ExecutionContext, location: HubLocation, url: URL): Promise<Response> {
  const path = url.pathname.slice(location.path.length);
  const api = path.startsWith('/datasets/api/');
  const fail = (status: number, message: string) => new Response(api ? JSON.stringify({ error: message }) : errorPage(location, message), {
    status, headers: { 'Content-Type': api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!['GET', 'HEAD'].includes(request.method)) {
    const response = fail(405, 'Use GET to read dataset metadata.');
    response.headers.set('Allow', 'GET, HEAD');
    return response;
  }
  // Keep the old operator audit aliases after disabling automatic HTML rewrites.
  if (/^\/datasets\/audit(?:\/(?:index(?:\.html)?)?)?$/.test(path)) {
    return new Response(null, { status: 308, headers: { Location: `${location.base}/datasets/audit.html${url.search}` } });
  }
  const browse = (dataset?: string) => {
    const target = new URL(`${location.base}/`);
    target.search = individualFilters(url.searchParams).toString();
    // Collection pages counted sources, not scenes; their page numbers cannot carry over.
    if (dataset || /^\/datasets\/(?:collections|(?:collection-)?page-\d+)/.test(path)) target.searchParams.delete('page');
    if (dataset) target.searchParams.set('dataset', dataset);
    return new Response(null, { status: 308, headers: { Location: target.href } });
  };
  if (['/datasets', '/datasets/', '/datasets/index.html', '/index.html'].includes(path)) return browse();
  if (path === '/entry') return new Response(null, { status: 308, headers: { Location: `${location.base}/entry/${url.search}` } });
  const legacy = /^\/datasets\/entry\/(data-[a-f0-9]{24})$/.exec(path);
  if (legacy) return new Response(null, { status: 308, headers: { Location: `${location.base}/entry/${legacy[1]}${url.search}` } });
  if (['/entry/', '/datasets/entry/'].includes(path)) {
    const id = url.searchParams.get('id') || '';
    if (!/^data-[a-f0-9]{24}$/.test(id)) return fail(404, 'Dataset entry not found.');
    const query = new URLSearchParams(url.searchParams); query.delete('id');
    return new Response(null, { status: 308, headers: { Location: `${location.base}/entry/${id}${query.size ? '?' + query : ''}` } });
  }
  if (/^\/datasets\/(?:collections|(?:collection-)?page-\d+)(?:\.html)?\/?$/.test(path)) return browse();
  const collection = /^\/datasets\/((?:hf|public)-[a-z0-9-]+-[a-f0-9]{12})(?:\.html)?\/?$/.exec(path);
  const entry = /^\/entry\/(data-[a-f0-9]{24})$/.exec(path);
  const apiEntry = /^\/datasets\/api\/entry\/(data-[a-f0-9]{24})$/.exec(path);
  const apiIndex = path === '/datasets/api/index';
  // Existing API clients consume this direct launch URL. Keep its one-hop contract.
  const open = /^\/(?:datasets\/)?open\/(data-[a-f0-9]{24})$/.exec(path);
  if (path !== '/' && path !== '/datasets/api/entries' && !apiIndex && !apiEntry && !entry && !open && !collection) return fail(404, 'Dataset entry not found.');
  const filters = entry || apiEntry || apiIndex || open || collection ? new URLSearchParams() : individualFilters(url.searchParams);
  // Read the current inventory before the response cache. Removed entries and
  // search results must not survive a catalog deployment in an older cache.
  const index = await individualIndex(env.CATALOG_ASSETS, location.origin);
  const freshFeed = Boolean(index.discovery && !entry && !apiEntry && !apiIndex && !open && !collection && !filters.has('seed'));
  if (freshFeed) filters.set('seed', defaultFeedSeed());
  if (collection) return index.sources.some(source => source.id === collection[1] && source.count > 0)
    ? browse(collection[1]) : fail(404, 'Dataset entry not found.');
  if (open) {
    const model = await readIndividual(env.CATALOG_ASSETS, location.origin, index, open[1]);
    if (!model) return fail(404, 'Dataset entry not found.');
    const target = model.openUrl && (model.viewerUrl || model.candidateViewerUrl);
    return new Response(null, { status: 302, headers: { Location: target && isCatalogOpenUrl(target) ? preferredViewerUrl(target, location.viewerHost) : datasetPath(model), 'Cache-Control': 'no-store' } });
  }
  const cacheQuery = new URLSearchParams(filters);
  if (location.viewerHost) cacheQuery.set('viewerHost', location.viewerHost);
  cacheQuery.set('_catalog', index.generation);
  cacheQuery.set('_ui', HUB_UI_VERSION);
  const key = new Request(`${location.origin}${url.pathname}?${cacheQuery}`);
  const cached = freshFeed ? undefined : await caches.default.match(key);
  if (cached) return respond(request, cached);
  let body: string;
  if (apiIndex) body = JSON.stringify(index);
  else if (entry || apiEntry) {
    const model = await readIndividual(env.CATALOG_ASSETS, location.origin, index, (entry || apiEntry)![1]);
    if (!model) return fail(404, 'Dataset entry not found.');
    body = apiEntry ? catalogEntryContent(model, 'github', 'github') : catalogEntryPage(model, true, location.viewerHost);
  } else {
    const result = await searchIndividuals(env.CATALOG_ASSETS, location.origin, index, filters, env.HUB_DB);
    body = api ? JSON.stringify({ ...result, ...(index.unit ? { unit: index.unit } : {}), dataset: individualSelection(index.sources, filters.get('dataset') || '') })
      : individualIndexPage(location, index, result, filters);
  }
  // Hash the response content so template-only releases also invalidate a
  // browser's conditional request, even when the model inventory is unchanged.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const etag = '"' + [...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('') + '"';
  const response = new Response(body, { headers: { 'Content-Type': api && !apiEntry ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300, no-transform', 'ETag': etag } });
  if (request.method === 'GET' && !freshFeed) ctx.waitUntil(caches.default.put(key, response.clone()));
  // Seeded responses revalidate against the current generation. One-off fresh
  // feeds bypass both the internal cache and browser storage.
  return respond(request, response, freshFeed);
}
