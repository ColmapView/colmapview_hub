export const PHOTO_LABELS = {
  complete_export_checked: 'All photos verified in export',
  sample_checked: 'Photo sample checked',
  partial: 'Photos partially available',
  path_policy_required: 'Photos need setup',
  companion_archive: 'Photos in a separate archive',
  not_found: 'No loose photos found',
  not_included: 'Photos not included',
  review_required: 'Photo association needs review',
  not_checked: 'Photos not checked',
  unresolved: 'Photo paths ambiguous',
} as const;

export type PhotoStatus = keyof typeof PHOTO_LABELS;
export const isPhotoStatus = (value: unknown): value is PhotoStatus => typeof value === 'string' && Object.hasOwn(PHOTO_LABELS, value);
export const photoLabel = (status: PhotoStatus) => PHOTO_LABELS[status];

export interface ScenePhotoAudit {
  status: Exclude<PhotoStatus, 'unresolved'>;
  checkedAt: string;
  listingComplete: boolean;
  policy: string;
  summary: string;
  sceneRoot: string;
  policyNote: string;
  mediaScope?: string;
  photoCollection?: string;
  mappingFile?: string;
  associationFile?: string;
  mappingCheck?: { entries: number; matched: number; manifestAgrees?: number };
  nameCheck?: { registered: number; matched: number; missing: number; ambiguous: number; scope?: 'prefix'; totalRegistered?: number };
  proposedNameCheck?: { registered: number; matched: number };
  archive?: { path: string; photos: number; nameSampleMatched: true; browserRangeRead: true;
    format?: 'zip' | 'tar'; inventoryComplete?: boolean; bytes?: number; indexBytes?: number; prefixComplete?: boolean;
    sample?: { path: string; registeredName: string; headerOffset: number; dataOffset: number; bytes: number;
      sha256: string; pixels: 'decoded'; dimensionsMatch: boolean } };
  samplePath?: string;
  sampleBrowserRead?: true;
  samplePixels?: 'decoded' | 'deferred';
  sampleRegisteredName?: string;
  samplePrefixSha256?: string;
  sampleDimensionsMatch?: boolean;
  sampleWidth?: number;
  sampleHeight?: number;
  sampleCalibration?: { width: number; height: number; sha256: string };
}
