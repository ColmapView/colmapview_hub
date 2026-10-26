import { deriveLongId, equalHashes, hash } from './crypto';
import { metadataFingerprint, readWordlists, recordKey, toPublicMetadata } from './records';
import { hubStorage } from './storage';
import { InputError, isObject, parseCreateInput, readBoundedJson } from './validation';
import { publicationEnabled, verifyPublicationChallenge } from './publication-turnstile';
import { verifyPublicationSource } from './publication-verification';
import { isSourceVerification, type PublicationRecord, type SharedDataset, type SharedDatasetPage } from '../shared/publication';
import { ID_PATTERN, MAX_RECORD_BYTES, SHARE_PATH, isListedId } from '../shared/model';
import type { HubLocation } from './pages';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
export const pendingPublicationKey = (id: string) => `pending-publications/${id}.json`;
export const sharedFeedCacheKey = (base: string, cursor?: string) => `${base}/api/publications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;

async function storedSubmission(env: Env, key: string): Promise<Record<string, unknown> | null> {
  const object = await hubStorage.get(env.HUB_DB, key);
  if (!object) return null;
  if (object.size > MAX_RECORD_BYTES) throw new Error('Stored submission is too large');
  const record: unknown = await object.json();
  if (!isObject(record)) throw new Error('Invalid stored submission');
  return record;
}

export function publicationConfiguration(env: Env): Response {
  return json({ enabled: publicationEnabled(env), ...(publicationEnabled(env) ? { siteKey: env.HUB_TURNSTILE_SITE_KEY } : {}) });
}

/** Public discovery queries the verified listing index, never unlisted or pending entries. */
export async function sharedDatasets(env: Env, cursor?: string): Promise<SharedDatasetPage> {
  if (cursor && (cursor.length > 2048 || [...cursor].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) throw new InputError('Invalid page cursor.');
  // Keyset cursors are scoped to the verified public namespace and bounded page size.
  const selected = await hubStorage.list(env.HUB_DB, { namespace: 'listed', limit: 4, verifiedOnly: true, includeMetadata: true, ...(cursor ? { cursor } : {}) });
  const entries = selected.objects.map(object => {
    const id = object.key.slice('listed/'.length, -'.json'.length);
    if (!ID_PATTERN.test(id) || !isListedId(id) || object.size > MAX_RECORD_BYTES) return null;
    let record: unknown;
    try { record = JSON.parse(object.metadataJson ?? 'null'); } catch { return null; }
    if (!isObject(record) || record.access === 'private' || record.listed !== true || !isSourceVerification(record.verification)
      || typeof record.createdAt !== 'string') return null;
    try {
      const card = toPublicMetadata(record, id);
      return { id, title: card.title, description: card.description, viewerUrl: card.viewerUrl,
        ...(card.license ? { license: card.license } : {}), ...(card.assets ? { assets: card.assets } : {}),
        createdAt: record.createdAt, verification: record.verification } satisfies SharedDataset;
    } catch { return null; }
  });
  return { entries: entries.filter((entry): entry is SharedDataset => entry !== null), ...(selected.truncated ? { cursor: selected.cursor } : {}) };
}

/** A public listing has a separate, bot-checked endpoint. Existing share links keep their original behavior. */
export async function submitPublication(request: Request, env: Env, location: HubLocation): Promise<Response> {
  if (!publicationEnabled(env)) throw new InputError('Sharing on Hub is not available yet.', 503);
  const body = await readBoundedJson(request);
  if (!isObject(body)) throw new InputError('Invalid publication request.');
  const { turnstileToken, listingAcknowledged, ...metadata } = body;
  if (listingAcknowledged !== true) throw new InputError('Confirm that this dataset will be publicly discoverable on Hub.');
  const input = parseCreateInput({ ...metadata, listed: true }, location.local);
  if (input.access !== 'public') throw new InputError('Only public datasets can be shared on Hub.', 400);
  await verifyPublicationChallenge(request, turnstileToken, env);
  const words = await readWordlists(env.HUB_DB);
  const id = await deriveLongId(env.HUB_KEY, input.managementSecret, words, true);
  const ownerHash = await hash(input.managementSecret);
  const card = { viewerUrl: input.viewerUrl, title: input.title, description: input.description, thumbnailBase64: input.thumbnailBase64,
    ...(input.license ? { license: input.license } : {}), ...(input.assets ? { assets: input.assets } : {}) };
  const fingerprint = await hash(metadataFingerprint(card));
  const result = (published: boolean) => json(published ? { status: 'published', id, shareUrl: `${location.origin}${SHARE_PATH}/${id}`,
    catalogUrl: `${location.base}/datasets/#shared-datasets` } : { status: 'pending', id, message: 'Submitted for review. It will appear on Hub after its source is verified.' }, published ? 201 : 202);
  const previous = await storedSubmission(env, recordKey(id));
  const existing = previous ?? await storedSubmission(env, pendingPublicationKey(id));
  if (existing) {
    if (typeof existing.ownerHash !== 'string' || typeof existing.fingerprint !== 'string'
      || !equalHashes(existing.ownerHash, ownerHash) || !equalHashes(existing.fingerprint, fingerprint)) {
      throw new InputError('This publication changed. Start a new submission.', 409);
    }
    if (previous && !isSourceVerification(previous.verification)) throw new InputError('This older listing needs operator review. Start a new submission.', 409);
    return result(Boolean(previous));
  }
  const checked = await verifyPublicationSource(card.viewerUrl, env, location.origin);
  const record: PublicationRecord = { ...card, viewerUrl: checked.viewerUrl, id, schemaVersion: 1, ownerHash, fingerprint,
    createdAt: new Date().toISOString(), listed: true, ...(checked.verification ? { verification: checked.verification } : { reviewReason: checked.reviewReason }) };
  const stored = await hubStorage.put(env.HUB_DB, checked.verification ? recordKey(id) : pendingPublicationKey(id), JSON.stringify(record), {
    createOnly: true,
    ...(checked.verification ? { listing: { title: record.title, createdAt: record.createdAt } } : {}),
  });
  if (!stored) throw new InputError('This submission is already being processed. Try again.', 409);
  if (checked.verification) await caches.default.delete(sharedFeedCacheKey(location.base)).catch(() => undefined);
  else console.info('Hub publication pending review', { id });
  return result(Boolean(checked.verification));
}

/** Cache public-only metadata briefly at the edge; browsers always request a fresh response. */
export async function sharedDatasetResponse(env: Env, location: HubLocation, ctx: ExecutionContext, cursor?: string): Promise<Response> {
  if (cursor && cursor.length > 2048) throw new InputError('Invalid page cursor.');
  const key = sharedFeedCacheKey(location.base, cursor);
  const cached = await caches.default.match(key);
  if (cached) return new Response(cached.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  const response = json(await sharedDatasets(env, cursor));
  const saved = response.clone(); saved.headers.set('Cache-Control', 'public, max-age=5');
  ctx.waitUntil(caches.default.put(key, saved));
  return response;
}
