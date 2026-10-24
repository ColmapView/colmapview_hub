import { expect, it } from 'vitest';
import { canOpenIndividual, individualEntry, type IndividualProof, type IndividualRecord, type IndividualSource } from '../src/shared/individual-catalog';
import type { VideoFrameMappingEvidence } from '../src/shared/video-frame-mappings';
import type { CatalogEntry } from '../src/shared/catalog';

const files = { cameras: 'scene/cameras.bin', images: 'scene/images.bin', points3d: 'scene/points3D.bin' };
const source: IndividualSource = { id: 'source', sourceId: 'hf:owner/data', title: 'Data', label: 'Data', provider: 'huggingface',
  license: 'mit', access: 'public', start: 0, count: 1, listingComplete: true };
const mapping: VideoFrameMappingEvidence = { schemaVersion: 1, manifestVersion: 5, sha256: 'a'.repeat(64),
  url: `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${'a'.repeat(64)}.manifest.json`,
  baseManifestSha256: 'b'.repeat(64), receiptSha256: 'c'.repeat(64), revision: 'd'.repeat(40), modelFiles: files,
  registeredImages: 285, mappedImages: 285, videoSources: 6, sampleCount: 18, temporalScope: 'per_pose',
  checkedAt: '2026-10-24T12:00:00Z', viewerCommit: 'e'.repeat(40), viewerVersion: '0.23.0' };
const proof: IndividualProof = { level: 'native_layout_checked', delivery: 'cors_headers_checked', statusLabel: 'Native model checked',
  summary: 'Native selection with separately checked video imagery.', scope: 'Native counts and sampled pixels.',
  checkedAt: mapping.checkedAt, viewerVersion: mapping.viewerVersion,
  viewerUrl: 'https://colmapview.opsiclear.com/?url=' + encodeURIComponent(mapping.url),
  sceneCompatibility: { status: 'native_headers_checked', revision: mapping.revision, cameraRecordChecked: true, poseRecordChecked: true,
    cameras: 6, images: 285, points: 23226 }, photoAvailability: 'video_frames', videoFrameMapping: mapping };
const row = (selected: IndividualProof): IndividualRecord => ['data-' + '1'.repeat(24), 0, 'colmap', 'scene', 'COLMAP', null, files, selected];

it('reports registered views and unique videos separately without requiring a model export claim', () => {
  expect(canOpenIndividual(row(proof), source)).toBe(true);
  const entry = individualEntry(row(proof), source, { ...source, checkedAt: mapping.checkedAt, audits: [],
    facts: [{ label: 'Pinned revision', value: mapping.revision }] } as unknown as CatalogEntry);
  expect(entry.facts.find(item => item.label === 'Video frame manifest')?.value).toBe('285 matched views from 6 source videos');
  expect(proof.sceneManifest).toBeUndefined();
});

it('rejects changed source selections, counts, viewer targets and old-runtime claims', () => {
  for (const changed of [{ revision: 'f'.repeat(40) }, { registeredImages: 286 }, { mappedImages: 286 }, { videoSources: 286 },
    { viewerVersion: '0.22.0' }, { modelFiles: { ...files, images: 'other/images.bin' } }, { modelFiles: { cameras: files.cameras, images: files.images } }]) {
    expect(canOpenIndividual(row({ ...proof, videoFrameMapping: { ...mapping, ...changed } }), source)).toBe(false);
  }
  expect(canOpenIndividual(row({ ...proof, viewerUrl: 'https://colmapview.opsiclear.com/?url=https://unreviewed.test/model' }), source)).toBe(false);
  const partial = { ...proof, photoAvailability: 'partial' as const, videoFrameMapping: { ...mapping, mappedImages: 100 } };
  expect(canOpenIndividual(row(partial), source)).toBe(true);
  const entry = individualEntry(row(partial), source, { ...source, checkedAt: mapping.checkedAt, audits: [],
    facts: [{ label: 'Pinned revision', value: mapping.revision }] } as unknown as CatalogEntry);
  expect(entry.facts.find(item => item.label === 'Camera imagery')?.value).toBe('Images partially available');
  expect(entry.facts.some(item => item.label === 'Original photographs')).toBe(false);
  expect(canOpenIndividual(row({ ...partial, photoAvailability: 'video_frames' }), source)).toBe(false);
});
