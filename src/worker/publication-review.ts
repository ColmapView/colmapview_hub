import { ID_PATTERN, isListedId } from '../shared/model';
import { publicationSource, type PublicationRecord } from '../shared/publication';
import { isObject, parseMetadata } from './validation';
import { storedFields } from './storage';

/** Called by the authenticated operator CLI after reviewing public access and the actual dataset format. */
export function reviewPublication(value: unknown): PublicationRecord {
  if (!isObject(value) || typeof value.id !== 'string' || !ID_PATTERN.test(value.id) || !isListedId(value.id)
    || value.schemaVersion !== 1 || value.listed !== true || value.access === 'private'
    || typeof value.ownerHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.ownerHash)
    || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid pending publication.');
  const metadata = parseMetadata(value);
  publicationSource(metadata.viewerUrl);
  return { ...metadata, id: value.id, schemaVersion: 1, listed: true, ownerHash: value.ownerHash, fingerprint: value.fingerprint,
    createdAt: value.createdAt, verification: { method: 'manual_review', checkedAt: new Date().toISOString() } };
}

/** Atomically promote this exact pending submission; collisions never replace another publication. */
export async function approvePublication(database: D1Database, record: PublicationRecord): Promise<void> {
  const fields = storedFields(JSON.stringify(record), { title: record.title, createdAt: record.createdAt });
  await database.batch([
    database.prepare(`INSERT INTO hub_entries
      (namespace,id,body_json,preview_jpeg,source_bytes,listing_json,title,created_at,owner_hash,fingerprint,publication_verified)
      SELECT 'listed',id,?,preview_jpeg,?,?,title,created_at,owner_hash,fingerprint,1 FROM hub_entries
      WHERE namespace='pending-publications' AND id=? AND owner_hash=? AND fingerprint=?
      ON CONFLICT(namespace,id) DO NOTHING`).bind(fields.body, fields.bytes, fields.listing, record.id, record.ownerHash, record.fingerprint),
    database.prepare(`DELETE FROM hub_entries WHERE namespace='pending-publications' AND id=? AND owner_hash=? AND fingerprint=?
      AND EXISTS (SELECT 1 FROM hub_entries WHERE namespace='listed' AND id=? AND owner_hash=? AND fingerprint=?)`)
      .bind(record.id, record.ownerHash, record.fingerprint, record.id, record.ownerHash, record.fingerprint),
  ]);
  const owner = await database.prepare("SELECT owner_hash, fingerprint FROM hub_entries WHERE namespace='listed' AND id=?")
    .bind(record.id).first<{ owner_hash: string; fingerprint: string }>();
  if (owner?.owner_hash !== record.ownerHash || owner.fingerprint !== record.fingerprint) throw new Error('The pending submission changed or a different record owns this ID.');
}
