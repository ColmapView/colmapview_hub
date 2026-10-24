/** Model-bound media evidence. A decoded sample is separate from complete export verification. */
export interface VideoFrameMappingEvidence {
  schemaVersion: 1; manifestVersion: 4 | 5;
  url: string; sha256: string; baseManifestSha256: string; receiptSha256: string;
  revision: string; modelFiles: Record<string, string>;
  registeredImages: number; mappedImages: number; videoSources: number; sampleCount: number;
  temporalScope: 'per_pose' | 'synchronized';
  checkedAt: string; viewerCommit: string; viewerVersion: string;
}

export function isVideoFrameMappingEvidence(value: unknown, files: Record<string, string> | null,
  images: number | null | undefined, revision: string | undefined): value is VideoFrameMappingEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !files) return false;
  const item = value as VideoFrameMappingEvidence;
  const hash = (value: unknown, length = 64) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
  const count = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
  const version = typeof item.viewerVersion === 'string' && /^\d+\.\d+\.\d+$/.test(item.viewerVersion) ? item.viewerVersion.split('.').map(Number) : [];
  return item.schemaVersion === 1 && [4, 5].includes(item.manifestVersion) && hash(item.sha256) && hash(item.baseManifestSha256)
    && hash(item.receiptSha256) && hash(item.viewerCommit, 40) && hash(item.revision, 40) && item.revision === revision
    && item.url === `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${item.sha256}.manifest.json`
    && count(item.registeredImages, 1) && item.registeredImages === images
    && count(item.mappedImages, 1) && item.mappedImages <= item.registeredImages
    && count(item.videoSources, 1) && item.videoSources <= item.mappedImages
    && count(item.sampleCount, 1) && item.sampleCount >= item.videoSources
    && ['per_pose', 'synchronized'].includes(item.temporalScope)
    && version.length === 3 && (version[0] > 0 || version[1] >= 23)
    && typeof item.checkedAt === 'string' && Number.isFinite(Date.parse(item.checkedAt))
    && Boolean(item.modelFiles) && typeof item.modelFiles === 'object' && !Array.isArray(item.modelFiles)
    && Object.keys(item.modelFiles).length >= 2 && ['cameras', 'images', 'points3d', 'rigs', 'frames'].filter(role => files[role] !== undefined).every(role => item.modelFiles[role] === files[role])
    && Object.entries(item.modelFiles).every(([role, path]) => ['cameras', 'images', 'points3d', 'rigs', 'frames'].includes(role) && path === files[role]);
}
