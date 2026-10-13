export const PREVIEW_WIDTH = 600;
export const PREVIEW_HEIGHT = 315;
export const MAX_PREVIEW_BYTES = 64 * 1024;
export const MAX_REQUEST_BYTES = 128 * 1024;
export const ID_PATTERN = /^[A-Z][a-z]{2,13}[A-Z][a-z]{2,13}-(?:L)?[A-Za-z0-9_-]{16}$/;
export const isListedId = (id: string) => id.slice(id.indexOf('-') + 1).length === 17;

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
  publicAcknowledged: true;
}

export interface LinkRecord extends LinkMetadata {
  schemaVersion: 1;
  id: string;
  ownerHash: string;
  fingerprint: string;
  createdAt: string;
  listed: boolean;
}

export interface ListedLink { id: string; title: string; createdAt: string; assets?: AssetSummary }
