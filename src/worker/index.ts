import { ID_PATTERN, LOOPBACK_HOSTS, SECRET_PATTERN, SHARE_PATH, VIEWER_ORIGINS } from '../shared/model';
import type { CardRecord, LinkMetadata, LinkRecord, Ownership } from '../shared/model';
import { clientIdentity, deriveLongId, deriveShortId, equalHashes, equalSecrets, hash } from './crypto';
import { MAX_MISSES, REFUSAL_FLOOR_MS, VERIFIED_BOT_MAX_MISSES } from './guard';
import { lookupTarget, missKey } from './ids';
import { blockedPage, cardPage, errorPage, hubLocation, managementPage, notFoundPage, unavailablePage } from './pages';
import type { HubLocation } from './pages';
import { metadataFingerprint, readShareRecord, readOwnership, readWordlists, recordKey } from './records';
import { base64Bytes, InputError, isLoopbackOrigin, parseCreateInput, readBoundedJson } from './validation';
import { individualRoute } from './individual-routes';
import { individualIndex, readIndividual } from './individual-data';
import { datasetShareId } from '../shared/dataset-share';
import { isCatalogOpenUrl } from '../shared/catalog';
import type { CatalogEntry } from '../shared/catalog';
import { catalogEntryPage } from './catalog-pages';
import { hubStorage } from './storage';
import { retiredAuthRoute } from './retired-auth';
import { publicationConfiguration, sharedDatasetResponse, submitPublication } from './publications';
import { VIEWER_DOCUMENT_HEADER, viewerDocument } from './viewer-document';
import { preferredViewerUrl, viewerHost } from '../shared/viewer-host';
export { LookupGuard } from './guard';

const UNAVAILABLE = 'The Hub is temporarily unavailable. Please try again.';
type View = 'card' | 'preview' | 'manage';

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

const redirect = (target: string, status: 302 | 307 | 308) => new Response(null, { status, headers: { Location: target } });

/**
 * Another site embedding or prefetching a card or preview gets a plain 404: no record read, no strike. A cross-site
 * prefetch arrives as a document request, so its Sec-Purpose marks it; otherwise a hostile page could spend a
 * visitor's misses. Navigations still work.
 */
const crossSiteSubresource = (request: Request) => request.headers.get('Sec-Fetch-Site') === 'cross-site'
  && (request.headers.get('Sec-Fetch-Dest') !== 'document' || (request.headers.get('Sec-Purpose') ?? '').includes('prefetch'));

/** Cloudflare's verified bots carry the secret token from a Transform Rule; a missing or guessed token gets the normal limit. */
function missLimit(request: Request, env: Env): number {
  const presented = request.headers.get('X-Hub-Verified-Bot');
  return env.VERIFIED_BOT_TOKEN && presented && equalSecrets(presented, env.VERIFIED_BOT_TOKEN) ? VERIFIED_BOT_MAX_MISSES : MAX_MISSES;
}

const listingsEnabled = (env: Env) => env.HUB_LISTINGS_ENABLED === 'true';

/** Page routes answer with HTML pages; API routes answer with JSON. */
function failure(location: HubLocation, api: boolean, status: number, message?: string): Response {
  if (api) return json({ error: message ?? (status === 404 ? 'Link not found.' : UNAVAILABLE) }, status);
  if (status === 404) return html(notFoundPage(location), 404);
  if (status >= 500) return html(unavailablePage(location), status);
  return html(errorPage(location, message ?? 'This request is invalid.'), status);
}

function blocked(location: HubLocation, api: boolean, seconds: number): Response {
  const headers = { 'Retry-After': String(seconds) };
  return api ? json({ error: 'Too many attempts. Try again later.' }, 429, headers)
    : html(blockedPage(location, Math.ceil(seconds / 60)), 429, headers);
}

function contentSecurityPolicy(local: boolean, analytics = false): string {
  const frames = [...VIEWER_ORIGINS, ...(local ? LOOPBACK_HOSTS.map(host => `http://${host}:*`) : [])];
  const tag = analytics ? ' https://www.googletagmanager.com' : '';
  const collection = analytics ? ' https://*.google-analytics.com' : '';
  return ["default-src 'none'", `script-src 'self'${tag}`, "style-src 'self'", `img-src 'self'${tag}${collection}`, "font-src 'self'",
    `frame-src ${frames.join(' ')}`, `connect-src 'self'${tag}${collection}`, "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
}

const CSP = contentSecurityPolicy(false);
const LOCAL_CSP = contentSecurityPolicy(true);

function allowedOrigin(request: Request, location: HubLocation): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  if (origin === location.origin || VIEWER_ORIGINS.includes(origin)) return origin;
  return location.local && isLoopbackOrigin(origin) ? origin : null;
}

/**
 * The headers every response carries and no body for HEAD, also for the 503 sent when the Hub location is misconfigured.
 * Without a location, as for that 503, the policy frames only the viewer origins.
 */
function withSharedHeaders(request: Request, result: Response, location?: HubLocation): Response {
  const headers = new Headers(result.headers);
  const viewer = headers.get(VIEWER_DOCUMENT_HEADER) === '1';
  headers.delete(VIEWER_DOCUMENT_HEADER);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (!viewer) headers.set('Referrer-Policy', 'no-referrer');
  const publicCatalog = [200, 304].includes(result.status) && headers.get('Content-Type')?.startsWith('text/html')
    && /^\/hub\/(?:$|entry\/data-[a-f0-9]{24}$)/.test(new URL(request.url).pathname);
  if (!viewer) headers.set('Content-Security-Policy', publicCatalog ? contentSecurityPolicy(Boolean(location?.local), true) : location?.local ? LOCAL_CSP : CSP);
  return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status, headers });
}

/** Shared headers, CORS for allowed API callers, and HEAD bodies removed, all in one place. */
function finalize(request: Request, location: HubLocation, api: boolean, result: Response): Response {
  const response = withSharedHeaders(request, result, location);
  const origin = api ? allowedOrigin(request, location) : null;
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Expose-Headers', 'Retry-After');
    response.headers.set('Vary', 'Origin');
  }
  return response;
}

async function guardFor(request: Request, env: Env) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) throw new Error('Client identity unavailable');
  return env.LOOKUP_GUARDS.getByName(await clientIdentity(env.HUB_KEY, ip));
}

/** A lookup's single guard call, made after its record read: a 429 while the client must wait, otherwise null. */
type GuardCheck = (missFingerprint: string | null) => Promise<Response | null>;

async function lookupGuard(request: Request, env: Env, location: HubLocation, api: boolean, limit: number): Promise<GuardCheck> {
  const guard = await guardFor(request, env);
  return async missFingerprint => {
    const wait = await guard.lookup(missFingerprint, limit);
    return wait ? blocked(location, api, wait) : null;
  };
}

async function createLink(request: Request, env: Env, location: HubLocation): Promise<Response> {
  if (!allowedOrigin(request, location)) return json({ error: 'This origin cannot create links.' }, 403);
  const guard = await guardFor(request, env);
  const wait = await guard.admitCreation();
  if (wait) return blocked(location, true, wait);
  const input = parseCreateInput(await readBoundedJson(request), location.local);
  if (input.listed && !listingsEnabled(env)) return json({ error: 'Listings are turned off.' }, 403);
  const words = await readWordlists(env.HUB_DB);
  const ownerHash = await hash(input.managementSecret);
  const metadata: LinkMetadata = { viewerUrl: input.viewerUrl, title: input.title, description: input.description, thumbnailBase64: input.thumbnailBase64,
    ...(input.license ? { license: input.license } : {}), ...(input.assets ? { assets: input.assets } : {}) };
  const fingerprint = await hash(metadataFingerprint(metadata));
  // Existing viewers validate url under /hub; newer viewers prefer the additive shareUrl field.
  const created = (id: string) => json({ id, url: `${location.base}/${id}`, shareUrl: `${location.origin}${SHARE_PATH}/${id}`,
    managementPath: `${location.path}/manage/${id}` }, 201);
  /** The same owner retrying: identical content replays, changed content is refused. */
  const replay = (id: string, record: Ownership) => equalHashes(record.fingerprint, fingerprint)
    ? created(id) : json({ error: 'This draft changed. Create a new link instead.' }, 409);
  // Private and listed links get one long name; public links try sixteen short ones.
  const long = input.access === 'private' || input.listed;
  const ids = long ? [await deriveLongId(env.HUB_KEY, input.managementSecret, words, input.listed)]
    : [...new Set(await Promise.all(Array.from({ length: 16 }, (_, attempt) => deriveShortId(env.HUB_KEY, input.managementSecret, words, attempt))))];
  // Check every candidate before using a vacancy: an earlier collision may have been deleted
  // since this owner's first request. Its existing link must still win on a retry.
  const existing = await Promise.all(ids.map(id => readOwnership(env.HUB_DB, id)));
  for (const [index, record] of existing.entries()) if (record && equalHashes(record.ownerHash, ownerHash)) return replay(ids[index], record);
  for (const [index, id] of ids.entries()) {
    if (existing[index]) continue;
    const record: LinkRecord = { ...metadata, schemaVersion: 1, id, ownerHash, fingerprint, createdAt: new Date().toISOString(),
      listed: input.listed, ...(input.access === 'private' ? { access: 'private' as const } : {}) };
    const stored = await hubStorage.put(env.HUB_DB, recordKey(id), JSON.stringify(record), {
      createOnly: true,
      ...(record.listed ? { listing: { title: record.title, createdAt: record.createdAt,
        ...(record.assets ? { assets: JSON.stringify(record.assets) } : {}) } } : {}),
    });
    if (stored) {
      return created(id);
    }
    const current = await readOwnership(env.HUB_DB, id);
    if (current && equalHashes(current.ownerHash, ownerHash)) return replay(id, current);
  }
  return json({ error: long ? 'This link name is taken. Create a new link.' : 'No free link name. Create a new link.' }, 409);
}

async function lookup(request: Request, env: Env, location: HubLocation, url: URL, id: string, view: View): Promise<Response> {
  if (crossSiteSubresource(request)) return failure(location, false, 404);
  const check = await lookupGuard(request, env, location, false, missLimit(request, env));
  let target: { key: string; redirect: boolean } | null;
  let record: CardRecord | null = null;
  let dataset: CatalogEntry | null = null;
  try {
    target = await lookupTarget(id, () => readWordlists(env.HUB_DB));
    const stored = target ? await readShareRecord(env.HUB_DB, target.key) : null;
    if (stored && 'datasetId' in stored) {
      if (view === 'card') {
        const entry = await readIndividual(env.CATALOG_ASSETS, location.origin,
          await individualIndex(env.CATALOG_ASSETS, location.origin), stored.datasetId);
        dataset = entry?.shareName === stored.id ? entry : null;
      }
    } else record = stored;
  } catch (error) {
    const refusal = await check(null);
    if (refusal) return refusal;
    throw error;
  }
  const refusal = await check(record || dataset ? null : await hash(missKey(id)));
  if (refusal) return refusal;
  if (!record && !dataset) return failure(location, false, 404);
  // Open browser navigations directly; non-navigation fetches still provide social preview metadata.
  // This runs after the same lookup guard as previews and management pages.
  const navigation = request.headers.get('Sec-Fetch-Dest') === 'document' || request.headers.get('Sec-Fetch-Mode') === 'navigate';
  const vary = { Vary: 'Sec-Fetch-Dest, Sec-Fetch-Mode' };
  if (dataset) {
    if (!navigation && target?.redirect) return redirect(`${location.origin}${SHARE_PATH}/${target.key}${url.search}`, 308);
    return datasetResponse(request, env, location, dataset);
  }
  if (!record) return failure(location, false, 404);
  if (view === 'card' && navigation) return location.viewerHost
    ? redirect(preferredViewerUrl(record.viewerUrl, location.viewerHost), 302) : viewerDocument(env, location, record.viewerUrl);
  const linkBase = url.pathname.startsWith(`${SHARE_PATH}/`) ? `${location.origin}${SHARE_PATH}` : location.base;
  if (target?.redirect) return redirect(`${linkBase}${view === 'manage' ? '/manage' : ''}/${record.id}${view === 'preview' ? '/preview.jpg' : ''}${url.search}`, 308);
  if (view === 'preview') return new Response(base64Bytes(record.thumbnailBase64), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' } });
  return view === 'manage' ? html(managementPage(location, record)) : html(cardPage(location, record), 200, vary);
}

/** A path no record can answer still counts as a miss, so probing sub-paths gains nothing. */
async function miss(request: Request, env: Env, location: HubLocation, id: string): Promise<Response> {
  if (crossSiteSubresource(request)) return failure(location, false, 404);
  const check = await lookupGuard(request, env, location, false, missLimit(request, env));
  return (await check(await hash(missKey(id)))) ?? failure(location, false, 404);
}

async function deleteLink(request: Request, env: Env, location: HubLocation, id: string): Promise<Response> {
  if (!allowedOrigin(request, location)) return json({ error: 'This origin cannot manage links.' }, 403);
  const check = await lookupGuard(request, env, location, true, MAX_MISSES);
  const presented = request.headers.get('Authorization')?.match(/^Bearer (.*)$/)?.[1];
  const secret = presented && SECRET_PATTERN.test(presented) ? presented : undefined;
  let owned: boolean;
  let ownerHash: string;
  try {
    const record = secret && ID_PATTERN.test(id) ? await readOwnership(env.HUB_DB, id) : null;
    ownerHash = secret ? await hash(secret) : '';
    owned = secret ? equalHashes(record?.ownerHash ?? '0'.repeat(64), ownerHash) : false;
  } catch (error) {
    const refusal = await check(null);
    if (refusal) return refusal;
    throw error;
  }
  // Treat both unknown IDs and incorrect ownership keys identically, including strikes.
  const refusal = await check(owned ? null : await hash(missKey(id)));
  if (refusal) return refusal;
  if (!owned) return failure(location, true, 404);
  await hubStorage.delete(env.HUB_DB, recordKey(id), ownerHash);
  return new Response(null, { status: 204 });
}

function decodeId(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Public catalog aliases use bounded built assets, with the same lookup cooldown as share links. */
async function datasetResponse(request: Request, env: Env, location: HubLocation, entry: CatalogEntry): Promise<Response> {
  if (request.headers.get('Sec-Fetch-Dest') === 'document' || request.headers.get('Sec-Fetch-Mode') === 'navigate') {
    const target = entry.openUrl && (entry.viewerUrl || entry.candidateViewerUrl);
    if (target && isCatalogOpenUrl(target)) return location.viewerHost
      ? redirect(preferredViewerUrl(target, location.viewerHost), 302) : viewerDocument(env, location, target);
  }
  return html(catalogEntryPage(entry, false, location.viewerHost), 200, { Vary: 'Sec-Fetch-Dest, Sec-Fetch-Mode' });
}

async function lookupDataset(request: Request, env: Env, location: HubLocation, code: string, validPath: boolean): Promise<Response> {
  const check = await lookupGuard(request, env, location, false, missLimit(request, env));
  const id = validPath ? datasetShareId(code) : undefined;
  let entry: CatalogEntry | null = null;
  try {
    if (id) entry = await readIndividual(env.CATALOG_ASSETS, location.origin, await individualIndex(env.CATALOG_ASSETS, location.origin), id);
  } catch (error) {
    const refusal = await check(null);
    if (refusal) return refusal;
    throw error;
  }
  const refusal = await check(entry ? null : await hash(`catalog-dataset:${code}`));
  if (refusal) return refusal;
  if (!entry) return failure(location, false, 404);
  return datasetResponse(request, env, location, entry);
}

async function route(request: Request, env: Env, ctx: ExecutionContext, location: HubLocation, url: URL): Promise<Response> {
  if (url.origin === location.origin && (url.pathname === SHARE_PATH || url.pathname.startsWith(`${SHARE_PATH}/`))) {
    if (!['GET', 'HEAD'].includes(request.method)) return failure(location, false, 404);
    if (url.pathname === SHARE_PATH || url.pathname === `${SHARE_PATH}/`) return redirect(`${location.base}/`, 307);
    const parts = url.pathname.slice(SHARE_PATH.length + 1).split('/').map(decodeId);
    if (parts[0] === 'd') {
      if (crossSiteSubresource(request)) return failure(location, false, 404);
      if (parts.length === 3 && parts[2] === '' && datasetShareId(parts[1])) return redirect(`${location.origin}${SHARE_PATH}/d/${parts[1]}`, 308);
      return lookupDataset(request, env, location, parts[1] || '', parts.length === 2);
    }
    if (parts.length === 2 && parts[1] === '') return redirect(`${location.origin}${url.pathname.slice(0, -1)}${url.search}`, 308);
    if (parts.length === 1) return lookup(request, env, location, url, parts[0], 'card');
    if (parts.length === 2 && parts[1] === 'preview.jpg') return lookup(request, env, location, url, parts[0], 'preview');
    return miss(request, env, location, parts[0]);
  }
  if (url.origin !== location.origin || (url.pathname !== location.path && !url.pathname.startsWith(`${location.path}/`))) return failure(location, false, 404);
  const path = url.pathname.slice(location.path.length);
  if (path === '') return redirect(`${location.base}/${url.search}`, 307);
  if (path === '/' || path === '/index.html' || path === '/entry' || path.startsWith('/entry/') || path.startsWith('/open/') || path === '/datasets' || path.startsWith('/datasets/')) {
    return individualRoute(request, env, ctx, location, url);
  }
  if (path.startsWith('/api/')) {
    if (request.method === 'OPTIONS') return allowedOrigin(request, location)
      ? new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } })
      : new Response(null, { status: 403 });
    if (path === '/api/publications/config' && request.method === 'GET') return publicationConfiguration(env);
    if (path === '/api/publications' && request.method === 'GET') {
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip) throw new Error('Client identity unavailable');
      const admitted = await env.HUB_PUBLICATION_READS.limit({ key: await clientIdentity(env.HUB_KEY, ip) });
      if (!admitted.success) return blocked(location, true, 60);
      return sharedDatasetResponse(env, location, ctx, url.searchParams.get('cursor') ?? undefined, url.searchParams.get('preview') === 'inline');
    }
    if (path === '/api/publications' && request.method === 'POST') {
      if (!allowedOrigin(request, location)) return json({ error: 'This origin cannot publish datasets.' }, 403);
      const wait = await (await guardFor(request, env)).admitCreation();
      if (wait) return blocked(location, true, wait);
      return submitPublication(request, env, location);
    }
    if (path === '/api/links' && request.method === 'POST') return createLink(request, env, location);
    const deletion = /^\/api\/links\/([^/]+)$/.exec(path);
    if (deletion && request.method === 'DELETE') return deleteLink(request, env, location, decodeId(deletion[1]));
    return failure(location, true, 404);
  }
  if (!['GET', 'HEAD'].includes(request.method)) return failure(location, false, 404);
  const parts = path.slice(1).split('/').map(decodeId);
  // Static files are served before the Worker runs; a request that still arrives here is a plain miss, not a strike.
  if (parts[0] === 'assets' || parts[0] === 'fonts' || parts[0].includes('.')) return failure(location, false, 404);
  if (parts[0] === 'manage') return parts.length === 2 && parts[1] ? lookup(request, env, location, url, parts[1], 'manage') : miss(request, env, location, parts[1] || path);
  if (parts.length === 2 && parts[1] === '') return redirect(`${location.origin}${url.pathname.slice(0, -1)}${url.search}`, 308);
  if (parts.length === 1) return lookup(request, env, location, url, parts[0], 'card');
  if (parts.length === 2 && parts[1] === 'preview.jpg') return lookup(request, env, location, url, parts[0], 'preview');
  return miss(request, env, location, parts[0]);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/auth/')) return retiredAuthRoute(request);
    const arrived = Date.now();
    let location: HubLocation;
    try { location = hubLocation(env); }
    catch { return withSharedHeaders(request, json({ error: UNAVAILABLE }, 503)); }
    const url = new URL(request.url);
    location = { ...location, viewerHost: viewerHost(url.searchParams) };
    const api = url.pathname.startsWith(`${location.path}/api/`) || url.pathname.startsWith(`${location.path}/datasets/api/`);
    let result: Response;
    try { result = await route(request, env, ctx, location, url); }
    catch (error) {
      if (error instanceof InputError) result = failure(location, api, error.status, error.message);
      else {
        // Log only the error, never the request or its IP.
        console.error('Unexpected Hub error', error);
        result = failure(location, api, 503);
      }
    }
    if (result.status === 429) await scheduler.wait(Math.max(0, arrived + REFUSAL_FLOOR_MS - Date.now()));
    return finalize(request, location, api, result);
  },
} satisfies ExportedHandler<Env>;
