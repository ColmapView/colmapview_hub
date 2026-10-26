import { isSourceVerification } from '../shared/publication';
import { InputError, isObject } from './validation';

export const WORDLIST_KEY = 'internal/wordlists-v1.json';
type Namespace = 'links' | 'listed' | 'pending-publications';
export interface StoredJson { size: number; json<T = unknown>(): Promise<T> }
export interface StoredListing { key: string; size: number; customMetadata?: Record<string, string>; metadataJson?: string }
export interface WriteOptions { createOnly?: boolean; listing?: Record<string, string> }

function address(key: string): { namespace: Namespace; id: string } {
  const match = /^(links|listed|pending-publications)\/([^/]{1,128})\.json$/.exec(key);
  if (!match) throw new Error('Invalid Hub record key');
  return { namespace: match[1] as Namespace, id: match[2] };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Keep the wire format compatible while storing preview bytes outside metadata JSON. */
export function storedFields(body: string, listing?: Record<string, string>) {
  let value: unknown;
  try { value = JSON.parse(body); } catch { /* Preserve unreadable legacy records without publishing them. */ }
  let preview: Uint8Array | null = null;
  const hasPreview = isObject(value) && typeof value.thumbnailBase64 === 'string' && value.thumbnailBase64.length > 0;
  if (isObject(value) && typeof value.thumbnailBase64 === 'string') {
    try {
      const binary = atob(value.thumbnailBase64);
      if (btoa(binary) === value.thumbnailBase64 && binary.length <= 64 * 1024) {
        preview = Uint8Array.from(binary, char => char.charCodeAt(0));
        delete value.thumbnailBase64;
      }
    } catch { /* Tolerant reads retain invalid legacy values for the existing reader to reject. */ }
  }
  const object = isObject(value) ? value : {};
  return { body: value === undefined ? body : JSON.stringify(value), preview,
    bytes: new TextEncoder().encode(body).byteLength, listing: listing ? JSON.stringify(listing) : null,
    title: typeof object.title === 'string' ? object.title : null,
    createdAt: typeof object.createdAt === 'string' ? object.createdAt : null,
    ownerHash: typeof object.ownerHash === 'string' ? object.ownerHash : null,
    fingerprint: typeof object.fingerprint === 'string' ? object.fingerprint : null,
    verified: hasPreview && object.listed === true && object.access !== 'private' && typeof object.createdAt === 'string'
      && isSourceVerification(object.verification) ? 1 : 0 };
}

async function get(db: D1Database, key: string): Promise<StoredJson | null> {
  if (key === WORDLIST_KEY) {
    const row = await db.prepare('SELECT body_json, source_bytes FROM hub_settings WHERE key = ?').bind(key)
      .first<{ body_json: string; source_bytes: number }>();
    return row ? { size: row.source_bytes, json: async <T>() => JSON.parse(row.body_json) as T } : null;
  }
  const { namespace, id } = address(key);
  const row = await db.prepare('SELECT body_json, preview_jpeg, source_bytes FROM hub_entries WHERE namespace = ? AND id = ?')
    .bind(namespace, id).first<{ body_json: string; preview_jpeg: number[] | ArrayBuffer | null; source_bytes: number }>();
  if (!row) return null;
  return { size: row.source_bytes, json: async <T>() => {
    const value: unknown = JSON.parse(row.body_json);
    if (row.preview_jpeg !== null && isObject(value)) value.thumbnailBase64 = encodeBase64(new Uint8Array(row.preview_jpeg));
    return value as T;
  } };
}

export function entryInsert(db: D1Database, key: string, body: string, options: WriteOptions = {}): D1PreparedStatement {
  const { namespace, id } = address(key), fields = storedFields(body, options.listing);
  const conflict = options.createOnly ? 'DO NOTHING' : `DO UPDATE SET body_json=excluded.body_json,
    preview_jpeg=excluded.preview_jpeg, source_bytes=excluded.source_bytes, listing_json=excluded.listing_json,
    title=excluded.title, created_at=excluded.created_at, owner_hash=excluded.owner_hash,
    fingerprint=excluded.fingerprint, publication_verified=excluded.publication_verified`;
  return db.prepare(`INSERT INTO hub_entries
    (namespace,id,body_json,preview_jpeg,source_bytes,listing_json,title,created_at,owner_hash,fingerprint,publication_verified)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(namespace,id) ${conflict}`).bind(namespace, id, fields.body,
    fields.preview, fields.bytes, fields.listing,
    fields.title, fields.createdAt, fields.ownerHash, fields.fingerprint, fields.verified);
}

async function put(db: D1Database, key: string, body: string, options: WriteOptions = {}): Promise<boolean> {
  if (key === WORDLIST_KEY) {
    const bytes = new TextEncoder().encode(body).byteLength;
    const result = await db.prepare(`INSERT INTO hub_settings (key,body_json,source_bytes) VALUES (?,?,?)
      ON CONFLICT(key) ${options.createOnly ? 'DO NOTHING' : 'DO UPDATE SET body_json=excluded.body_json,source_bytes=excluded.source_bytes'}`)
      .bind(key, body, bytes).run();
    return result.meta.changes > 0;
  }
  return (await entryInsert(db, key, body, options).run()).meta.changes > 0;
}

async function remove(db: D1Database, key: string): Promise<void> {
  if (key === WORDLIST_KEY) { await db.prepare('DELETE FROM hub_settings WHERE key = ?').bind(key).run(); return; }
  const { namespace, id } = address(key);
  await db.prepare('DELETE FROM hub_entries WHERE namespace = ? AND id = ?').bind(namespace, id).run();
}

function readCursor(cursor: string | undefined, namespace: Namespace): string {
  if (!cursor) return '';
  try {
    const value: unknown = JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/')));
    if (isObject(value) && value.version === 1 && value.namespace === namespace && typeof value.id === 'string'
      && value.id.length <= 128 && ![...value.id].some(char => char === '/' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return value.id;
  } catch { /* A cursor is scoped to one public listing, never a SQL expression. */ }
  throw new InputError('Invalid page cursor.');
}

async function list(db: D1Database, options: { namespace: Namespace; cursor?: string; limit: number; verifiedOnly?: boolean; includeMetadata?: boolean }) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000) throw new Error('Invalid Hub listing bound');
  const after = readCursor(options.cursor, options.namespace);
  const rows = await db.prepare(`SELECT id,source_bytes,listing_json${options.includeMetadata ? ',body_json' : ''} FROM hub_entries
    WHERE namespace = ? AND id > ? ${options.verifiedOnly ? 'AND publication_verified = 1' : ''}
    ORDER BY id LIMIT ?`).bind(options.namespace, after, options.limit + 1)
    .all<{ id: string; source_bytes: number; listing_json: string | null; body_json?: string }>();
  const selected = rows.results.slice(0, options.limit), truncated = rows.results.length > options.limit;
  const objects: StoredListing[] = selected.map(row => ({ key: `${options.namespace}/${row.id}.json`, size: row.source_bytes,
    ...(row.listing_json ? { customMetadata: JSON.parse(row.listing_json) as Record<string, string> } : {}),
    ...(row.body_json !== undefined ? { metadataJson: row.body_json } : {}) }));
  const cursor = truncated ? btoa(JSON.stringify({ version: 1, namespace: options.namespace, id: selected.at(-1)!.id }))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '') : undefined;
  return { objects, truncated, ...(cursor ? { cursor } : {}) };
}

/** SQL-backed repository; callers never scan unlisted or pending entries for public discovery. */
export const hubStorage = { get, put, delete: remove, list };
