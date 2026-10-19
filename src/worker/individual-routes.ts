import { catalogEntryPage } from './catalog-pages';
import { individualFilters, individualIndex, readIndividual, searchIndividuals } from './individual-data';
import { individualIndexPage } from './individual-pages';
import { errorPage } from './pages';
import type { HubLocation } from './pages';
import { individualSelection } from '../shared/individual-catalog';
import { isCatalogOpenUrl, datasetPath } from '../shared/catalog';
import { HUB_UI_VERSION } from '../shared/ui-version';
import { defaultFeedSeed } from '../shared/discovery';

const REVALIDATE = 'public, no-cache, must-revalidate, no-transform';
const respond = (request: Request, response: Response) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', REVALIDATE);
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  return new Response(request.headers.get('If-None-Match') === headers.get('ETag') ? null : response.body, {
    status: request.headers.get('If-None-Match') === headers.get('ETag') ? 304 : response.status, headers,
  });
};

/** A public, operator-built metadata namespace. No user-created share record,
 * management secret, R2 listing, or private lookup path is reachable here. */
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
  if (path === '/datasets') return new Response(null, { status: 308, headers: { Location: `${location.base}/datasets/${url.search}` } });
  const browse = (dataset?: string) => {
    const target = new URL(`${location.base}/datasets/${url.search}`);
    // Collection pages counted sources, not scenes; their page numbers cannot carry over.
    target.searchParams.delete('page');
    if (dataset) target.searchParams.set('dataset', dataset);
    return new Response(null, { status: 308, headers: { Location: target.href } });
  };
  if (/^\/datasets\/(?:collections|(?:collection-)?page-\d+)(?:\.html)?\/?$/.test(path)) return browse();
  const collection = /^\/datasets\/((?:hf|public)-[a-z0-9-]+-[a-f0-9]{12})(?:\.html)?\/?$/.exec(path);
  const entry = /^\/datasets\/entry\/(data-[a-f0-9]{24})$/.exec(path);
  const open = /^\/datasets\/open\/(data-[a-f0-9]{24})$/.exec(path);
  if (path !== '/datasets/' && path !== '/datasets/api/entries' && !entry && !open && !collection) return fail(404, 'Dataset entry not found.');
  const filters = entry || open || collection ? new URLSearchParams() : individualFilters(url.searchParams);
  // Read the current inventory before the response cache. Removed entries and
  // search results must not survive a catalog deployment in an older cache.
  const index = await individualIndex(env.CATALOG_ASSETS, location.origin);
  if (index.discovery && !entry && !open && !collection && !filters.has('seed')) filters.set('seed', defaultFeedSeed());
  if (collection) return index.sources.some(source => source.id === collection[1] && source.count > 0)
    ? browse(collection[1]) : fail(404, 'Dataset entry not found.');
  if (open) {
    const model = await readIndividual(env.CATALOG_ASSETS, location.origin, index, open[1]);
    if (!model) return fail(404, 'Dataset entry not found.');
    const target = model.openUrl && (model.viewerUrl || model.candidateViewerUrl);
    return new Response(null, { status: 302, headers: { Location: target && isCatalogOpenUrl(target) ? target : datasetPath(model), 'Cache-Control': 'no-store' } });
  }
  const cacheQuery = new URLSearchParams(filters);
  cacheQuery.set('_catalog', index.generation);
  cacheQuery.set('_ui', HUB_UI_VERSION);
  const key = new Request(`${location.origin}${url.pathname}?${cacheQuery}`);
  const cached = await caches.default.match(key);
  if (cached) return respond(request, cached);
  let body: string;
  if (entry) {
    const model = await readIndividual(env.CATALOG_ASSETS, location.origin, index, entry[1]);
    if (!model) return fail(404, 'Dataset entry not found.');
    body = catalogEntryPage(model);
  } else {
    const result = await searchIndividuals(env.CATALOG_ASSETS, location.origin, index, filters);
    body = api ? JSON.stringify({ ...result, ...(index.unit ? { unit: index.unit } : {}), dataset: individualSelection(index.sources, filters.get('dataset') || '') })
      : individualIndexPage(location, index, result, filters);
  }
  // Hash the response content so template-only releases also invalidate a
  // browser's conditional request, even when the model inventory is unchanged.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const etag = '"' + [...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('') + '"';
  const response = new Response(body, { headers: { 'Content-Type': api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300, no-transform', 'ETag': etag } });
  if (request.method === 'GET') ctx.waitUntil(caches.default.put(key, response.clone()));
  // The Cache API stores a short-lived internal copy. Browser and outer CDN
  // responses always revalidate against the current published generation.
  return respond(request, response);
}
