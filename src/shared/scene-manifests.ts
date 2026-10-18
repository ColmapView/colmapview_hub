export interface SceneManifestEvidence {
  url: string;
  sha256: string;
  selectionSha256: string;
  counts: { cameras: number; images: number; points: number };
  pointSource: string | null;
  pointFormat: 'xyz_ply' | 'colmap_binary' | 'colmap_text' | 'none';
  photoCount: number;
  maskCount: number;
  maskRole: 'unknown' | 'foreground' | 'validity';
  exportSha256: string;
  viewerCommit: string;
  viewerVersion: string;
}

const hash = (value: unknown, length = 64): value is string => typeof value === 'string'
  && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const count = (value: unknown, minimum = 0): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= minimum;
const pointSuffixes = { xyz_ply: '.ply', colmap_binary: '.bin', colmap_text: '.txt' } as const;
function validPointSource(format: unknown, path: unknown, points: unknown): boolean {
  if (format === 'none') return path === null && points === 0;
  return typeof format === 'string' && Object.hasOwn(pointSuffixes, format) && typeof path === 'string'
    && path.endsWith(pointSuffixes[format as keyof typeof pointSuffixes]);
}

/** A manifest launch cannot inherit a native count or an unrelated viewer URL. */
export function isSceneManifestEvidence(value: unknown): value is SceneManifestEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const counts = item.counts as SceneManifestEvidence['counts'] | undefined;
  return hash(item.sha256) && hash(item.selectionSha256) && hash(item.exportSha256) && hash(item.viewerCommit, 40)
    && item.url === `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${item.selectionSha256}.manifest.json`
    && Boolean(counts) && count(counts?.cameras, 1) && count(counts?.images, 1) && count(counts?.points)
    && count(item.photoCount) && item.photoCount <= counts!.images
    && count(item.maskCount) && item.maskCount <= item.photoCount
    && ['unknown', 'foreground', 'validity'].includes(String(item.maskRole))
    && validPointSource(item.pointFormat, item.pointSource, counts?.points)
    && typeof item.viewerVersion === 'string' && /^\d+\.\d+\.\d+$/.test(item.viewerVersion);
}

export function manifestViewerUrlMatches(viewerUrl: string | undefined, manifest: SceneManifestEvidence): boolean {
  try {
    const url = new URL(viewerUrl ?? '');
    return url.origin === 'https://colmapview.opsiclear.com' && url.pathname === '/' && !url.hash
      && [...url.searchParams].length === 1 && url.searchParams.get('url') === manifest.url;
  } catch { return false; }
}
