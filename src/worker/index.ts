import { ID_PATTERN } from '../shared/model';
import type { LinkRecord } from '../shared/model';
import { clientIdentity, deriveLegacyId, deriveShortId, equalHashes, hash } from './crypto';
import { cardPage, galleryPage, errorPage, hubLocation, managementPage } from './pages';
import type { HubLocation } from './pages';
import { listPublicRecords, metadataFingerprint, readRecord, readWordlists, recordKey } from './records';
import { decodePreview, InputError, parseCreateInput, readBoundedJson } from './validation';
export { ClientGuard } from './clientGuard';

function response(body: BodyInit | null, status = 200, type = 'text/html; charset=utf-8', extra: HeadersInit = {}): Response {
  const headers = new Headers(extra);
  headers.set('Content-Type', type);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; frame-src https://colmapview.opsiclear.com https://colmapview.github.io; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  return new Response(body, { status, headers });
}

function blocked(seconds: number): Response {
  return response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), 429, 'application/json; charset=utf-8', { 'Retry-After': String(seconds) });
}

function notFound(location: HubLocation): Response { return response(errorPage(location, 'Link not found'), 404); }
function json(value: unknown, status = 200): Response { return response(JSON.stringify(value), status, 'application/json; charset=utf-8'); }

function allowedOrigin(request: Request, location: HubLocation): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  if ([location.origin, 'https://colmapview.opsiclear.com', 'https://colmapview.github.io'].includes(origin)) return origin;
  try {
    const url = new URL(origin);
    return url.origin === origin && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1'].includes(url.hostname) ? origin : null;
  } catch { return null; }
}

async function guardFor(request: Request, env: Env) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) throw new Error('Client identity unavailable');
  return env.CLIENT_GUARDS.getByName(await clientIdentity(env.HUB_KEY, ip));
}

async function createLink(request: Request, env: Env, location: HubLocation): Promise<Response> {
  if (!allowedOrigin(request, location)) return json({ error: 'This origin cannot create links.' }, 403);
  const guard = await guardFor(request, env);
  const delay = await guard.check();
  if (delay) return blocked(delay);
  const quota = await guard.admitCreation();
  if (quota) return blocked(quota);
  const input = parseCreateInput(await readBoundedJson(request));
  const words = await readWordlists(env.LINKS);
  const ownerHash = await hash(input.managementSecret);
  const metadata = { viewerUrl: input.viewerUrl, title: input.title, description: input.description, thumbnailBase64: input.thumbnailBase64,
    ...(input.license ? { license: input.license } : {}), ...(input.assets ? { assets: input.assets } : {}) };
  const fingerprint = await hash(metadataFingerprint(metadata));
  const result = (id: string) => json({ id, url: `${location.base}/${id}`, managementPath: `${location.path}/manage/${id}` }, 201);
  const replay = (record: LinkRecord): Response => {
    if (!equalHashes(record.ownerHash, ownerHash)) throw new Error('Unable to save link');
    if (!equalHashes(record.fingerprint, fingerprint)) throw new InputError('This draft changed. Create a new link instead.', 409);
    return result(record.id);
  };
  const legacyId = await deriveLegacyId(env.HUB_KEY, input.managementSecret, words, input.listed);
  if (!input.listed) {
    const legacy = await readRecord(env.LINKS, legacyId);
    if (legacy && equalHashes(legacy.ownerHash, ownerHash)) return replay(legacy);
  }
  const ids = input.listed ? [legacyId] : [...new Set(await Promise.all(Array.from({ length: 16 }, (_, attempt) =>
    deriveShortId(env.HUB_KEY, input.managementSecret, words, attempt))))];
  // Check every candidate before using a vacancy: an earlier collision may have been deleted
  // since this owner's first request. Its existing link must still win on a retry.
  const existing = await Promise.all(ids.map(id => readRecord(env.LINKS, id)));
  for (const record of existing) if (record && equalHashes(record.ownerHash, ownerHash)) return replay(record);
  const finalDelay = await guard.check();
  if (finalDelay) return blocked(finalDelay);
  for (const [index, id] of ids.entries()) {
    if (existing[index]) continue;
    const record: LinkRecord = { ...metadata, schemaVersion: 1, id, ownerHash, fingerprint, createdAt: new Date().toISOString(), listed: input.listed };
    const stored = await env.LINKS.put(recordKey(id), JSON.stringify(record), {
      onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' },
      ...(record.listed ? { customMetadata: { title: record.title, createdAt: record.createdAt,
        ...(record.assets ? { assets: JSON.stringify(record.assets) } : {}) } } : {}),
    });
    if (stored) return result(id);
    const current = await readRecord(env.LINKS, id);
    if (current && equalHashes(current.ownerHash, ownerHash)) return replay(current);
  }
  throw new Error('Unable to allocate a short name');
}

async function lookup(request: Request, env: Env, location: HubLocation, id: string, image: boolean, supported: boolean): Promise<Response> {
  const guard = await guardFor(request, env);
  const delay = await guard.check();
  if (delay) return blocked(delay);
  let record: LinkRecord | null;
  try { record = supported && ID_PATTERN.test(id) ? await readRecord(env.LINKS, id) : null; }
  catch (error) { const delay = await guard.finishLookup(null); if (delay) return blocked(delay); throw error; }
  const finalDelay = await guard.finishLookup(record ? null : await hash(id));
  if (finalDelay) return blocked(finalDelay);
  if (!record) return notFound(location);
  const body = image ? decodePreview(record.thumbnailBase64) : cardPage(location, record);
  return response(request.method === 'HEAD' ? null : body, 200, image ? 'image/jpeg' : 'text/html; charset=utf-8');
}

async function deleteLink(request: Request, env: Env, location: HubLocation, id: string): Promise<Response> {
  if (!allowedOrigin(request, location)) return json({ error: 'This origin cannot manage links.' }, 403);
  const guard = await guardFor(request, env);
  const delay = await guard.check();
  if (delay) return blocked(delay);
  const secret = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  const record = secret && ID_PATTERN.test(id) ? await readRecord(env.LINKS, id) : null;
  const owned = secret ? equalHashes(record?.ownerHash ?? '0'.repeat(64), await hash(secret)) : false;
  // Treat both unknown IDs and incorrect ownership keys identically, including strikes.
  const finalDelay = await guard.finishLookup(owned ? null : await hash(id));
  if (finalDelay) return blocked(finalDelay);
  if (!owned) return notFound(location);
  await env.LINKS.delete(recordKey(id));
  return response(null, 204);
}

function decodeId(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

async function route(request: Request, env: Env, location: HubLocation): Promise<Response> {
  const url = new URL(request.url);
  if (url.origin !== location.origin || (url.pathname !== location.path && !url.pathname.startsWith(location.path + '/'))) return notFound(location);
  const path = url.pathname.slice(location.path.length);
  if (path === '') return response(null, 307, 'text/plain', { Location: `${location.base}/` });
  if (request.method === 'OPTIONS' && path.startsWith('/api/')) return allowedOrigin(request, location)
    ? response(null, 204, 'text/plain', { 'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }) : response(null, 403);
  if (path === '/api/links' && request.method === 'POST') return createLink(request, env, location);
  const deletion = path.match(/^\/api\/links\/([^/]+)$/);
  if (deletion && request.method === 'DELETE') return deleteLink(request, env, location, decodeId(deletion[1]));
  if (!['GET', 'HEAD'].includes(request.method)) return notFound(location);
  if (path === '/') {
    const guard = await guardFor(request, env);
    const delay = await guard.check();
    if (delay) return blocked(delay);
    const cursor = url.searchParams.get('cursor') ?? undefined;
    if (cursor && cursor.length > 2048) throw new InputError('Invalid page cursor.');
    const page = await listPublicRecords(env.LINKS, cursor);
    const finalDelay = await guard.finishLookup(null);
    if (finalDelay) return blocked(finalDelay);
    return response(request.method === 'HEAD' ? null : galleryPage(location, page));
  }
  if (path === '/styles.css' || path === '/assets/client.js') {
    const assetUrl = new URL(url);
    assetUrl.pathname = path;
    const asset = await env.ASSETS.fetch(new Request(assetUrl, request));
    return response(request.method === 'HEAD' ? null : asset.body, asset.status, asset.headers.get('Content-Type') ?? 'application/octet-stream');
  }
  if (/^\/manage\/[^/]+$/.test(path)) return response(request.method === 'HEAD' ? null : managementPage(location));
  if (path.startsWith('/api/') || path.startsWith('/assets/')) return notFound(location);
  const parts = path.slice(1).split('/');
  const id = decodeId(parts[0]);
  return lookup(request, env, location, id, parts.length === 2 && parts[1] === 'preview.jpg', parts.length === 1 || (parts.length === 2 && parts[1] === 'preview.jpg'));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let result: Response;
    let location: HubLocation;
    try { location = hubLocation(env); }
    catch { return json({ error: 'The Hub is temporarily unavailable. Please try again.' }, 503); }
    try { result = await route(request, env, location); }
    catch (error) { result = json({ error: error instanceof InputError ? error.message : 'The Hub is temporarily unavailable. Please try again.' }, error instanceof InputError ? error.status : 503); }
    const origin = allowedOrigin(request, location);
    if (origin && new URL(request.url).pathname.startsWith(location.path + '/api/')) {
      result.headers.set('Access-Control-Allow-Origin', origin);
      result.headers.set('Vary', 'Origin');
    }
    if (request.method === 'HEAD') return new Response(null, { status: result.status, headers: result.headers });
    return result;
  },
} satisfies ExportedHandler<Env>;
