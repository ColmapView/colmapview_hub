import { catalogEntryPage } from './catalog-pages';
import { individualFilters, individualIndex, readIndividual, searchIndividuals } from './individual-data';
import { individualIndexPage } from './individual-pages';
import { errorPage } from './pages';
import type { HubLocation } from './pages';
import { individualSelection } from '../shared/individual-catalog';

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
  const entry = /^\/datasets\/entry\/(data-[a-f0-9]{24})$/.exec(path);
  if (path !== '/datasets/' && path !== '/datasets/api/entries' && !entry) return fail(404, 'Dataset entry not found.');
  const filters = entry ? new URLSearchParams() : individualFilters(url.searchParams);
  const key = new Request(`${location.origin}${url.pathname}${filters.size ? `?${filters}` : ''}`);
  const cached = await caches.default.match(key);
  if (cached) {
    if (request.headers.get('If-None-Match') === cached.headers.get('ETag')) return new Response(null, { status: 304, headers: cached.headers });
    return cached;
  }
  const index = await individualIndex(env.CATALOG_ASSETS, location.origin);
  let body: string;
  if (entry) {
    const model = await readIndividual(env.CATALOG_ASSETS, location.origin, index, entry[1]);
    if (!model) return fail(404, 'Dataset entry not found.');
    body = catalogEntryPage(model);
  } else {
    const result = await searchIndividuals(env.CATALOG_ASSETS, location.origin, index, filters);
    body = api ? JSON.stringify({ ...result, dataset: individualSelection(index.sources, filters.get('dataset') || '') })
      : individualIndexPage(location, index, result, filters);
  }
  // Hash the response content so template-only releases also invalidate a
  // browser's conditional request, even when the model inventory is unchanged.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const etag = '"' + [...new Uint8Array(digest)].slice(0, 16).map(byte => byte.toString(16).padStart(2, '0')).join('') + '"';
  const response = new Response(body, { headers: { 'Content-Type': api ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=300, no-transform', 'ETag': etag } });
  if (request.method === 'GET') ctx.waitUntil(caches.default.put(key, response.clone()));
  return request.headers.get('If-None-Match') === etag ? new Response(null, { status: 304, headers: response.headers }) : response;
}
