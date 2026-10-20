import { ID_PATTERN, isListedId } from '../shared/model';
import { publicationSource, type PublicationRecord } from '../shared/publication';
import { isObject, parseMetadata } from './validation';

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
