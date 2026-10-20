export interface SceneManifestEvidence {
  url: string;
  sha256: string;
  selectionSha256: string;
  counts: { cameras: number; images: number; points: number };
  pointSource: string | null;
  pointFormat: 'xyz_ply' | 'colmap_binary' | 'colmap_text' | 'numpy_frame' | 'archive_xyz_ply' | 'none';
  sourceCounts?: {cameras: number; images: number; points: number};
  frameIndices?: number[];
  pointAssociation?: {sceneRoot: string; method: 'identical_poses' | 'publisher_shared_world' | 'identical_native_model'};
  frameGeometry?: {sequencePath: string; frame: string; frameCount: number; role: 'points3D' | 'splat'; count: number;
    sourcePath: string; memberPath: string; memberSha256: string};
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
const pointSuffixes = { xyz_ply: '.ply', colmap_binary: '.bin', colmap_text: '.txt', numpy_frame: '.npz', archive_xyz_ply: '.tar.zst' } as const;
function validSourceSelection(item: Record<string, unknown>, selected: SceneManifestEvidence['counts'] | undefined): boolean {
  const source = item.sourceCounts as SceneManifestEvidence['sourceCounts'];
  if (source === undefined) return item.frameIndices === undefined && item.pointFormat !== 'numpy_frame';
  if (!['xyz_ply', 'numpy_frame'].includes(String(item.pointFormat))) return false;
  if (!source || !count(source.cameras, 1) || !count(source.images, 1) || source.points !== 0 || !selected) return false;
  if (item.frameIndices === undefined) return selected.cameras === source.cameras && selected.images === source.images;
  const indices = item.frameIndices;
  return Array.isArray(indices) && indices.length === selected.images && selected.images === selected.cameras
    && new Set(indices).size === indices.length && indices.every(index => count(index) && index < source.images);
}
function validPointSource(format: unknown, path: unknown, points: unknown): boolean {
  if (format === 'none') return path === null && points === 0;
  return typeof format === 'string' && Object.hasOwn(pointSuffixes, format) && typeof path === 'string'
    && path.endsWith(pointSuffixes[format as keyof typeof pointSuffixes]);
}

function validPointAssociation(item: Record<string, unknown>): boolean {
  if (item.pointAssociation === undefined) return true;
  const association = item.pointAssociation as SceneManifestEvidence['pointAssociation'];
  const root = association?.sceneRoot;
  if (!association || typeof root !== 'string' || !root || /[\\?#]/.test(root)
    || root.split('/').some(part => !part || part === '.' || part === '..')
    || typeof item.pointSource !== 'string' || !item.pointSource.startsWith(root + '/')
    || item.sourceCounts !== undefined || item.frameIndices !== undefined) return false;
  return association.method === 'identical_native_model'
    ? ['colmap_binary', 'colmap_text'].includes(String(item.pointFormat))
    : ['identical_poses', 'publisher_shared_world'].includes(association.method) && item.pointFormat === 'xyz_ply';
}

function validFrameGeometry(item: Record<string, unknown>, counts: SceneManifestEvidence['counts'] | undefined): boolean {
  if (item.frameGeometry === undefined) return item.pointFormat !== 'archive_xyz_ply';
  const version = String(item.viewerVersion).split('.').map(Number);
  if (version.length !== 3 || !version.every(value => count(value))
    || !(version[0] > 0 || version[1] > 19 || version[1] === 19 && version[2] >= 10)) return false;
  const frame = item.frameGeometry as SceneManifestEvidence['frameGeometry'];
  if (!frame || !counts || typeof frame.sequencePath !== 'string' || !frame.sequencePath
    || /[\\?#]/.test(frame.sequencePath) || frame.sequencePath.split('/').some(part => !part || part === '.' || part === '..')
    || typeof frame.frame !== 'string' || !/^\d{7}$/.test(frame.frame) || !count(frame.frameCount, 1) || !count(frame.count, 1)
    || frame.memberPath !== frame.frame + '.ply' || !hash(frame.memberSha256)
    || item.sourceCounts !== undefined || item.frameIndices !== undefined || item.pointAssociation !== undefined) return false;
  return frame.role === 'points3D'
    ? item.pointFormat === 'archive_xyz_ply' && frame.sourcePath === 'pointcloud/' + frame.sequencePath + '.tar.zst'
      && item.pointSource === frame.sourcePath && counts.points === frame.count
    : frame.role === 'splat' && frame.sourcePath === '3dgs/' + frame.sequencePath + '.zip'
      && item.pointFormat === 'none' && item.pointSource === null && counts.points === 0;
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
    && validSourceSelection(item, counts)
    && validPointAssociation(item)
    && validFrameGeometry(item, counts)
    && typeof item.viewerVersion === 'string' && /^\d+\.\d+\.\d+$/.test(item.viewerVersion);
}

export function manifestViewerUrlMatches(viewerUrl: string | undefined, manifest: SceneManifestEvidence): boolean {
  try {
    const url = new URL(viewerUrl ?? '');
    return url.origin === 'https://colmapview.opsiclear.com' && url.pathname === '/' && !url.hash
      && [...url.searchParams].length === 1 && url.searchParams.get('url') === manifest.url;
  } catch { return false; }
}
