export const PREVIEW_WIDTH = 600;
export const PREVIEW_HEIGHT = 315;
export const MAX_PREVIEW_BYTES = 64 * 1024;
export const MAX_REQUEST_BYTES = 128 * 1024;
/** A stored record adds hashes, an ID and timestamps to a request; this keeps every accepted request readable. */
export const MAX_RECORD_BYTES = 192 * 1024;
export const MAX_WORDLIST_BYTES = 1024 * 1024;
export const ID_PATTERN = /^[A-Z][a-z]{2,13}[A-Z][a-z]{2,13}(?:-(?:L)?[A-Za-z0-9_-]{16})?$/;
export const isListedId = (id: string) => /-L[A-Za-z0-9_-]{16}$/.test(id);
export type LinkAccess = 'public' | 'private';
/** ColmapView's production viewers; the first is the one whose pages the Hub links to. */
export const VIEWER_ORIGINS: readonly string[] = ['https://colmapview.opsiclear.com', 'https://colmapview.github.io'];
/** The loopback hosts a CSP frame source can also name; an IPv6 literal such as [::1] can't be framed, so it is refused. */
export const LOOPBACK_HOSTS: readonly string[] = ['localhost', '127.0.0.1'];
/** A management secret: 32 random bytes in base64url. */
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const SHARE_PATH = '/s';
/** The cooldown text a refused client sees, for example "Try again in 1 minute". */
export const waitText = (minutes: number) => `Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;

export interface LicenseInfo {
  id?: string;
  name?: string;
  url?: string;
}

export interface AssetSummary {
  format: 'folder' | 'zip';
  imageFormat: 'original' | 'jpeg';
  colmap: { files: number; cameras: number; points: number };
  images: number;
  masks: number;
  splats: number;
  viewerSettings: boolean;
  preview: boolean;
}

export interface LinkMetadata {
  viewerUrl: string;
  title: string;
  description: string;
  thumbnailBase64: string;
  license?: LicenseInfo;
  assets?: AssetSummary;
}

export interface CreateLinkInput extends LinkMetadata {
  managementSecret: string;
  listed: boolean;
  access: LinkAccess;
  publicAcknowledged: true;
}

export interface LinkRecord extends LinkMetadata {
  schemaVersion: 1;
  id: string;
  ownerHash: string;
  fingerprint: string;
  createdAt: string;
  listed: boolean;
  /** Present only on private links; a missing value means public. */
  access?: 'private';
}

export interface ListedLink { id: string; title: string; createdAt: string; assets?: AssetSummary }

/** The fields pages render. */
export interface CardRecord {
  id: string;
  title: string;
  description: string;
  viewerUrl: string;
  thumbnailBase64: string;
  license?: LicenseInfo;
  assets?: AssetSummary;
  access: LinkAccess;
}

export interface Ownership { ownerHash: string; fingerprint: string }
