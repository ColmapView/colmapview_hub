import { ID_PATTERN } from '../shared/model';
import type { CardRecord, LinkMetadata, LinkRecord, Ownership } from '../shared/model';
import { clientIdentity, deriveLongId, deriveShortId, equalHashes, hash } from './crypto';
import { MAX_MISSES, REFUSAL_FLOOR_MS } from './guard';
import { lookupTarget, missKey } from './ids';
import { blockedPage, cardPage, errorPage, galleryPage, hubLocation, managementPage, notFoundPage, unavailablePage } from './pages';
import type { HubLocation } from './pages';
import { listPublicRecords, metadataFingerprint, readCard, readOwnership, readWordlists, recordKey } from './records';
import { base64Bytes, InputError, parseCreateInput, readBoundedJson } from './validation';
export { LookupGuard } from './guard';

const VIEWER_ORIGINS = ['https://colmapview.opsiclear.com', 'https://colmapview.github.io'];
const UNAVAILABLE = 'The Hub is temporarily unavailable. Please try again.';
type View = 'card' | 'preview' | 'manage';

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });
}

function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

const redirect = (target: string, status: 307 | 308) => new Response(null, { status, headers: { Location: target } });

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

function contentSecurityPolicy(): string {
  return ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self'", "font-src 'self'",
    `frame-src ${VIEWER_ORIGINS.join(' ')}`, "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
}

function allowedOrigin(request: Request, location: HubLocation): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  if (origin === location.origin || VIEWER_ORIGINS.includes(origin)) return origin;
  try {
    const url = new URL(origin);
    return url.origin === origin && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1'].includes(url.hostname) ? origin : null;
  } catch { return null; }
}

/** Shared headers, CORS for allowed API callers, and HEAD bodies removed, all in one place. */
function finalize(request: Request, location: HubLocation, result: Response): Response {
  const headers = new Headers(result.headers);
  if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Content-Security-Policy', contentSecurityPolicy());
  const origin = allowedOrigin(request, location);
  if (origin && new URL(request.url).pathname.startsWith(`${location.path}/api/`)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Expose-Headers', 'Retry-After');
    headers.set('Vary', 'Origin');
  }
  return new Response(request.method === 'HEAD' ? null : result.body, { status: result.status, headers });
}

async function guardFor(request: Request, env: Env) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) throw new Error('Client identity unavailable');
  return env.LOOKUP_GUARDS.getByName(await clientIdentity(env.HUB_KEY, ip));
}

async function createLink(request: Request, env: Env, location: HubLocation): Promise<Response> {
  if (!allowedOrigin(request, location)) return json({ error: 'This origin cannot create links.' }, 403);
  const guard = await guardFor(request, env);
  const wait = await guard.admitCreation();
  if (wait) return blocked(location, true, wait);
  const input = parseCreateInput(await readBoundedJson(request));
  if (input.listed && env.HUB_LISTINGS_ENABLED !== 'true') return json({ error: 'Listings are turned off.' }, 403);
  const words = await readWordlists(env.LINKS);
  const ownerHash = await hash(input.managementSecret);
  const metadata: LinkMetadata = { viewerUrl: input.viewerUrl, title: input.title, description: input.description, thumbnailBase64: input.thumbnailBase64,
    ...(input.license ? { license: input.license } : {}), ...(input.assets ? { assets: input.assets } : {}) };
  const fingerprint = await hash(metadataFingerprint(metadata));
  const created = (id: string) => json({ id, url: `${location.base}/${id}`, managementPath: `${location.path}/manage/${id}` }, 201);
  /** The same owner retrying: identical content replays, changed content is refused. */
  const replay = (id: string, record: Ownership) => equalHashes(record.fingerprint, fingerprint)
    ? created(id) : json({ error: 'This draft changed. Create a new link instead.' }, 409);
  // Private and listed links get one long name; public links try sixteen short ones.
  const long = input.access === 'private' || input.listed;
  const ids = long ? [await deriveLongId(env.HUB_KEY, input.managementSecret, words, input.listed)]
    : [...new Set(await Promise.all(Array.from({ length: 16 }, (_, attempt) => deriveShortId(env.HUB_KEY, input.managementSecret, words, attempt))))];
  // Check every candidate before using a vacancy: an earlier collision may have been deleted
  // since this owner's first request. Its existing link must still win on a retry.
  const existing = await Promise.all(ids.map(id => readOwnership(env.LINKS, id)));
  for (const [index, record] of existing.entries()) if (record && equalHashes(record.ownerHash, ownerHash)) return replay(ids[index], record);
  for (const [index, id] of ids.entries()) {
    if (existing[index]) continue;
    const record: LinkRecord = { ...metadata, schemaVersion: 1, id, ownerHash, fingerprint, createdAt: new Date().toISOString(),
      listed: input.listed, ...(input.access === 'private' ? { access: 'private' as const } : {}) };
    const stored = await env.LINKS.put(recordKey(id), JSON.stringify(record), {
      onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' },
      ...(record.listed ? { customMetadata: { title: record.title, createdAt: record.createdAt,
        ...(record.assets ? { assets: JSON.stringify(record.assets) } : {}) } } : {}),
    });
    if (stored) return created(id);
    const current = await readOwnership(env.LINKS, id);
    if (current && equalHashes(current.ownerHash, ownerHash)) return replay(id, current);
  }
  return json({ error: long ? 'This link name is taken. Create a new link.' : 'No free link name. Create a new link.' }, 409);
}

async function lookup(request: Request, env: Env, location: HubLocation, id: string, view: View): Promise<Response> {
  const guard = await guardFor(request, env);
  let target: { key: string; redirect: boolean } | null;
  let record: CardRecord | null;
  try {
    target = await lookupTarget(id, () => readWordlists(env.LINKS));
    record = target ? await readCard(env.LINKS, target.key) : null;
  } catch (error) {
    const wait = await guard.lookup(null, MAX_MISSES);
    if (wait) return blocked(location, false, wait);
    throw error;
  }
  const wait = await guard.lookup(record ? null : await hash(missKey(id)), MAX_MISSES);
  if (wait) return blocked(location, false, wait);
  if (!record) return failure(location, false, 404);
  if (target?.redirect) return redirect(`${location.base}${view === 'manage' ? '/manage' : ''}/${record.id}${view === 'preview' ? '/preview.jpg' : ''}`, 308);
  if (view === 'preview') return new Response(base64Bytes(record.thumbnailBase64), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' } });
  return html(view === 'manage' ? managementPage(location, record) : cardPage(location, record));
}

/** A path no record can answer still counts as a miss, so probing sub-paths gains nothing. */
async function miss(request: Request, env: Env, location: HubLocation, id: string): Promise<Response> {
  const guard = await guardFor(request, env);
  const wait = await guard.lookup(await hash(missKey(id)), MAX_MISSES);
  return wait ? blocked(location, false, wait) : failure(location, false, 404);
}

async function deleteLink(request: Request, env: Env, location: HubLocation, id: string): Promise<Response> {
  if (!allowedOrigin(request, location)) return json({ error: 'This origin cannot manage links.' }, 403);
  const guard = await guardFor(request, env);
  const secret = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  let owned: boolean;
  try {
    const record = secret && ID_PATTERN.test(id) ? await readOwnership(env.LINKS, id) : null;
    owned = secret ? equalHashes(record?.ownerHash ?? '0'.repeat(64), await hash(secret)) : false;
  } catch (error) {
    const wait = await guard.lookup(null, MAX_MISSES);
    if (wait) return blocked(location, true, wait);
    throw error;
  }
  // Treat both unknown IDs and incorrect ownership keys identically, including strikes.
  const wait = await guard.lookup(owned ? null : await hash(missKey(id)), MAX_MISSES);
  if (wait) return blocked(location, true, wait);
  if (!owned) return failure(location, true, 404);
  await env.LINKS.delete(recordKey(id));
  return new Response(null, { status: 204 });
}

async function home(request: Request, env: Env, location: HubLocation, url: URL): Promise<Response> {
  const guard = await guardFor(request, env);
  const wait = await guard.lookup(null, MAX_MISSES);
  if (wait) return blocked(location, false, wait);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  if (cursor && cursor.length > 2048) throw new InputError('Invalid page cursor.');
  return html(galleryPage(location, await listPublicRecords(env.LINKS, cursor)));
}

function decodeId(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

async function route(request: Request, env: Env, location: HubLocation): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== location.origin || (url.pathname !== location.path && !url.pathname.startsWith(`${location.path}/`))) return failure(location, false, 404);
  const path = url.pathname.slice(location.path.length);
  if (path === '') return redirect(`${location.base}/`, 307);
  if (path.startsWith('/api/')) {
    if (request.method === 'OPTIONS') return allowedOrigin(request, location)
      ? new Response(null, { status: 204, headers: { 'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' } })
      : new Response(null, { status: 403 });
    if (path === '/api/links' && request.method === 'POST') return createLink(request, env, location);
    const deletion = /^\/api\/links\/([^/]+)$/.exec(path);
    if (deletion && request.method === 'DELETE') return deleteLink(request, env, location, decodeId(deletion[1]));
    return failure(location, true, 404);
  }
  if (!['GET', 'HEAD'].includes(request.method)) return failure(location, false, 404);
  if (path === '/') return home(request, env, location, url);
  const parts = path.slice(1).split('/').map(decodeId);
  // Static files are served before the Worker runs; a request that still arrives here is a plain miss, not a strike.
  if (parts[0] === 'assets' || parts[0] === 'fonts' || parts[0].includes('.')) return failure(location, false, 404);
  if (parts[0] === 'manage') return parts.length === 2 && parts[1] ? lookup(request, env, location, parts[1], 'manage') : miss(request, env, location, path);
  if (parts.length === 2 && parts[1] === '') return redirect(`${location.base}/${encodeURIComponent(parts[0])}`, 308);
  if (parts.length === 1) return lookup(request, env, location, parts[0], 'card');
  if (parts.length === 2 && parts[1] === 'preview.jpg') return lookup(request, env, location, parts[0], 'preview');
  return miss(request, env, location, parts[0]);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const arrived = Date.now();
    let location: HubLocation;
    try { location = hubLocation(env); }
    catch { return json({ error: UNAVAILABLE }, 503, { 'Cache-Control': 'no-store' }); }
    const api = new URL(request.url).pathname.startsWith(`${location.path}/api/`);
    let result: Response;
    try { result = await route(request, env, location); }
    catch (error) {
      result = error instanceof InputError ? failure(location, api, error.status, error.message) : failure(location, api, 503);
    }
    if (result.status === 429) await scheduler.wait(Math.max(0, arrived + REFUSAL_FLOOR_MS - Date.now()));
    return finalize(request, location, result);
  },
} satisfies ExportedHandler<Env>;
