export const PREVIEW_WIDTH = 600;
export const PREVIEW_HEIGHT = 315;
export const MAX_PREVIEW_BYTES = 64 * 1024;
export const MAX_REQUEST_BYTES = 128 * 1024;
export const ID_PATTERN = /^[A-Z][a-z]{2,13}[A-Z][a-z]{2,13}-[A-Za-z0-9_-]{16}$/;

export interface LicenseInfo {
  id?: string;
  name?: string;
  url?: string;
}

export interface LinkMetadata {
  viewerUrl: string;
  title: string;
  description: string;
  thumbnailBase64: string;
  license?: LicenseInfo;
}

export interface CreateLinkInput extends LinkMetadata {
  managementSecret: string;
  turnstileToken: string;
  publicAcknowledged: true;
}

export interface LinkRecord extends LinkMetadata {
  schemaVersion: 1;
  id: string;
  ownerHash: string;
  fingerprint: string;
  createdAt: string;
}

export const UNLISTED_NOTICE = 'Unlisted link. Anyone with the link can view its metadata and thumbnail. If you share it publicly, anyone can access them.';
