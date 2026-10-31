import { manifestViewerUrlMatches } from './scene-manifests';

/** Offline operator review only; no credentials or runtime source ingestion. */
export interface SourcePairRepairEvidence {
  sourceId: string; revision: string; kind: string; path: string; files: Record<string, string>;
  originalViewerUrl: string; url: string; sha256: string; receiptSha256: string;
  checkedAt: string; photos: number; samples: number; archiveUrl: string;
}
const hash = (value: unknown, length = 64) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
function originalTarget(value: unknown): string | null {
  try { return typeof value === 'string' ? new URL(value).searchParams.get('url') : null; }
  catch { return null; }
}
export function isSourcePairRepair(value: unknown, sourceId: string, revision: string | undefined,
  kind: string, path: string, files: Record<string, string> | null, viewerUrl: string | undefined,
  poses: number | null | undefined): value is SourcePairRepairEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !files) return false;
  const item = value as SourcePairRepairEvidence;
  const original = originalTarget(item.originalViewerUrl);
  return item.sourceId === sourceId && item.revision === revision && hash(revision, 40)
    && item.kind === kind && kind === 'colmap' && item.path === path
    && Boolean(item.files) && Object.keys(item.files).length === Object.keys(files).length
    && Object.entries(files).every(([key, path]) => item.files[key] === path)
    && hash(item.sha256) && hash(item.receiptSha256) && Boolean(item.checkedAt)
    && item.url === `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${item.sha256}.manifest.json`
    && Boolean(original?.match(/^https:\/\/colmapview\.opsiclear\.com\/hub\/datasets\/individual\/manifests\/[a-f0-9]{64}\.manifest\.json$/))
    && manifestViewerUrlMatches(item.originalViewerUrl, { url: original! }) && manifestViewerUrlMatches(viewerUrl, item)
    && Number.isSafeInteger(item.photos) && item.photos === poses && item.photos > 0
    && Number.isSafeInteger(item.samples) && item.samples >= 4 && item.samples <= item.photos
    && typeof item.archiveUrl === 'string' && /^https:\/\/huggingface\.co\/datasets\/[^/?#]+\/[^/?#]+\/resolve\/[a-f0-9]{40}\/[^?#]+\.zip$/.test(item.archiveUrl);
}
