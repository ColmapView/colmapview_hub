import type { SceneManifestEvidence } from './scene-manifests';

/** An additive media receipt. The base manifest still owns native geometry/export evidence. */
export interface VideoFrameRoutingEvidence {
  url: string; sha256: string; baseManifestUrl: string; baseManifestSha256: string; receiptSha256: string;
  count: number; timestamp: number; frame: string; frameCount: number;
  checkedAt: string; viewerVersion: string; viewerCommit: string;
  sample: { name: string; sourcePath: string; sha256: string; width: number; height: number };
}

export function isVideoFrameRoutingEvidence(value: unknown, model: SceneManifestEvidence): value is VideoFrameRoutingEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as VideoFrameRoutingEvidence, frame = model.frameGeometry;
  const hash = (value: unknown, length = 64) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
  const count = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
  const sample = item.sample;
  const version = typeof item.viewerVersion === 'string' && /^\d+\.\d+\.\d+$/.test(item.viewerVersion) ? item.viewerVersion.split('.').map(Number) : [];
  return Boolean(frame) && hash(item.sha256) && hash(item.receiptSha256) && hash(item.viewerCommit, 40)
    && item.url === `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${item.sha256}.manifest.json`
    && item.baseManifestUrl === model.url && item.baseManifestSha256 === model.sha256
    && item.count === model.counts.images && count(item.timestamp) && item.timestamp < item.frameCount
    && item.frame === frame!.frame && item.frameCount === frame!.frameCount
    && version.length === 3 && (version[0] > 0 || version[1] >= 21)
    && typeof item.checkedAt === 'string' && Number.isFinite(Date.parse(item.checkedAt))
    && Boolean(sample) && /^\d{4}\.png$/.test(sample?.name)
    && sample.sourcePath === `${frame!.sequencePath}/${frame!.sequencePath.split('/').at(-1)}_${sample.name.slice(0, -4)}.mp4`
    && hash(sample.sha256) && count(sample.width, 1) && count(sample.height, 1) && sample.width * sample.height <= 16_000_000;
}
