import { manifestViewerUrlMatches } from './scene-manifests';

export interface GaussianAsset {
  path: string; url: string; format: 'ply' | 'splat' | 'sog'; bytes: number; gaussians: number;
  role: 'model' | 'change_subset'; headerSha256: string; headerBytes: number;
  allowOrigin: string; headerCheckedAt: string; association: string;
}
export interface GaussianRoutingEvidence {
  sourceId: string; revision: string; kind: string; path: string; files: Record<string, string> | null;
  baseViewerUrl: string; url: string; sha256: string; receiptSha256: string;
  checkedAt: string; viewerVersion: string; viewerCommit: string; assets: GaussianAsset[];
}
const hash = (value: unknown, length = 64) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const sameFiles = (a: unknown, b: Record<string, string> | null) => a === null ? b === null
  : a !== null && typeof a === 'object' && !Array.isArray(a) && b !== null
    && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] === value);
function validBase(value: string): boolean {
  try {
    const target = new URL(value).searchParams.get('url');
    if (!target) return false;
    const dataset = new URL(target);
    return ['https:', 'http:'].includes(dataset.protocol) && !dataset.username && !dataset.password && !dataset.hash
      && manifestViewerUrlMatches(value, { url: target });
  }
  catch { return false; }
}

export function isGaussianRoutingEvidence(value: unknown, sourceId: string, revision: string | undefined,
  kind: string, path: string, files: Record<string, string> | null, viewerUrl: string | undefined): value is GaussianRoutingEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as GaussianRoutingEvidence;
  return sourceId.startsWith('hf:') && item.sourceId === sourceId && item.revision === revision && hash(revision, 40)
    && item.kind === kind && item.path === path && sameFiles(item.files, files)
    && hash(item.sha256) && hash(item.receiptSha256) && hash(item.viewerCommit, 40) && item.viewerVersion === '0.25.0'
    && typeof item.checkedAt === 'string' && Boolean(item.checkedAt) && typeof item.baseViewerUrl === 'string'
    && validBase(item.baseViewerUrl)
    && item.url === `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${item.sha256}.manifest.json`
    && manifestViewerUrlMatches(viewerUrl, item)
    && Array.isArray(item.assets) && item.assets.length > 0 && item.assets.length <= 1024
    && item.assets.every(asset => asset && typeof asset.path === 'string' && asset.path.split('/').every(part => part && part !== '.' && part !== '..')
      && !asset.path.includes('\\') && ['ply', 'splat', 'sog'].includes(asset.format) && asset.path.endsWith(`.${asset.format}`)
      && asset.url === `https://huggingface.co/datasets/${sourceId.slice(3)}/resolve/${revision}/${asset.path.split('/').map(encodeURIComponent).join('/')}`
      && positive(asset.bytes) && positive(asset.gaussians) && positive(asset.headerBytes) && asset.headerBytes <= asset.bytes
      && hash(asset.headerSha256) && ['model', 'change_subset'].includes(asset.role)
      && ['*', 'https://colmapview.opsiclear.com'].includes(asset.allowOrigin) && Boolean(asset.headerCheckedAt) && Boolean(asset.association))
    && new Set(item.assets.map(asset => asset.url)).size === item.assets.length;
}
