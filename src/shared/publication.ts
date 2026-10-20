import type { CardRecord, LinkRecord } from './model';

export interface SourceVerification {
  method: 'catalog_manifest' | 'hf_colmap_headers' | 'manual_review';
  checkedAt: string;
  revision?: string;
  cameras?: number;
  registeredImages?: number;
}

export interface PublicationRecord extends LinkRecord {
  verification?: SourceVerification;
  reviewReason?: string;
}

export interface SharedDataset extends Omit<CardRecord, 'thumbnailBase64' | 'access'> {
  createdAt: string;
  verification: SourceVerification;
}

export interface SharedDatasetPage { entries: SharedDataset[]; cursor?: string }

/** Publication never accepts embedded credentials, local files, or address literals. */
export function publicationSource(viewerUrl: string): URL {
  const viewer = new URL(viewerUrl);
  const values = viewer.searchParams.getAll('url');
  if (values.length !== 1 || !values[0]) throw new Error('Use a dataset link with one source URL.');
  const source = new URL(values[0]);
  const host = source.hostname.toLowerCase().replace(/\.$/, '');
  if (source.protocol !== 'https:' || source.port && source.port !== '443' || source.username || source.password
    || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')
    || ['.localhost', '.local', '.internal', '.home.arpa'].some(suffix => host.endsWith(suffix))) {
    throw new Error('Use a public HTTPS dataset URL.');
  }
  return source;
}

export function isSourceVerification(value: unknown): value is SourceVerification {
  if (!value || typeof value !== 'object') return false;
  const proof = value as Record<string, unknown>;
  return ['catalog_manifest', 'hf_colmap_headers', 'manual_review'].includes(String(proof.method))
    && typeof proof.checkedAt === 'string' && Number.isFinite(Date.parse(proof.checkedAt));
}
