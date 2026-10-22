export interface ArchiveRoutingEvidence {
  url: string;
  sha256: string;
  archivePath: string;
  bytes: number;
  indexBytes?: number;
  format: 'zip' | 'tar';
  photoLowerBound: number;
  sampleRegisteredName: string;
  sampleMemberPath: string;
  checkedAt: string;
  viewerVersion: string;
  viewerCommit: string;
}

function versionAtLeast(version: string, minimum: [number, number, number]): boolean {
  const parts = version.split('.').map(Number);
  return parts[0] > minimum[0] || parts[0] === minimum[0] && (parts[1] > minimum[1]
    || parts[1] === minimum[1] && parts[2] >= minimum[2]);
}

export function isArchiveRoutingEvidence(value: unknown): value is ArchiveRoutingEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as ArchiveRoutingEvidence;
  return typeof item.sha256 === 'string' && /^[a-f0-9]{64}$/.test(item.sha256)
    && item.url === `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${item.sha256}.manifest.json`
    && ['zip', 'tar'].includes(item.format) && typeof item.archivePath === 'string'
    && item.archivePath.endsWith('.' + item.format)
    && Number.isSafeInteger(item.bytes) && item.bytes > 0
    && Number.isSafeInteger(item.photoLowerBound) && item.photoLowerBound > 0
    && typeof item.sampleRegisteredName === 'string' && item.sampleRegisteredName.length > 0
    && typeof item.sampleMemberPath === 'string' && item.sampleMemberPath.length > 0
    && typeof item.viewerVersion === 'string' && /^\d+\.\d+\.\d+$/.test(item.viewerVersion) && versionAtLeast(item.viewerVersion, [0, 19, 2])
    && (item.indexBytes === undefined || item.format === 'tar' && Number.isSafeInteger(item.indexBytes)
      && item.indexBytes > 0 && item.indexBytes <= item.bytes && item.indexBytes % 512 === 0 && versionAtLeast(item.viewerVersion, [0, 20, 5]))
    && typeof item.viewerCommit === 'string' && /^[a-f0-9]{40}$/.test(item.viewerCommit)
    && typeof item.checkedAt === 'string' && Number.isFinite(Date.parse(item.checkedAt));
}
