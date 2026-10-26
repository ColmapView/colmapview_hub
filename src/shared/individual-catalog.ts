import type { CatalogEntry, CatalogSummary, CatalogVerification } from './catalog';
import { deliveryLabel } from './catalog';
import { licenseCategory } from './license-categories';
import type { LicenseCategory } from './license-categories';
import { photoLabel } from './scene-photos';
import type { PhotoStatus } from './scene-photos';
import { sceneDataText, sceneStatistics } from './scene-contents';
import { isSceneManifestEvidence, manifestViewerUrlMatches } from './scene-manifests';
import type { SceneManifestEvidence } from './scene-manifests';
import { isVideoFrameRoutingEvidence, type VideoFrameRoutingEvidence } from './video-frames';
import { isVideoFrameMappingEvidence, type VideoFrameMappingEvidence } from './video-frame-mappings';
import { isPhotoRoutingEvidence, photoRoutingUrlMatches } from './photo-routing';
import type { PhotoRoutingEvidence } from './photo-routing';
import { isArchiveRoutingEvidence, type ArchiveRoutingEvidence } from './archive-routing';
import type { FeedSelection } from './discovery';
import { CATALOG_SHARE_NAME } from './dataset-share';
import { VIDEO_CAPTURE_LABELS } from './video-capture';
import { isGaussianRoutingEvidence, type GaussianRoutingEvidence } from './gaussian-routing';

export interface IndividualSource {
  id: string; sourceId: string; title: string; label: string;
  sourceUrl?: string;
  provider: CatalogEntry['provider']; license: string; licenseCategory?: LicenseCategory; access: CatalogEntry['access'];
  start: number; count: number; listingComplete: boolean;
}
export interface IndividualIndex {
  schemaVersion: 1; generation: string; total: number; packSize: number; checkedAt: string;
  unit?: 'named_scene';
  sources: IndividualSource[];
  facets: Record<string, Record<string, { file: string; count: number }>>;
  kinds: Record<string, number>; levels: Record<string, number>; delivery: Record<string, number>;
  photos?: Partial<Record<PhotoStatus, number>>;
  contents?: Record<string, number>;
  thumbnails?: number;
  photoRouting?: Record<string, number>;
  discovery?: { schemaVersion: 1; file: 'feed.json' };
  incompleteCollections: number; scope: string;
  groupedVariants?: number;
}
export type IndividualProof = CatalogVerification & { statusLabel: string; viewerUrl?: string; sceneTitle?: string; sampleScope?: 'companion_asset';
  companionPointCloud?: string;
  gaussianRouting?: GaussianRoutingEvidence;
  sceneManifest?: SceneManifestEvidence;
  videoFrameRouting?: VideoFrameRoutingEvidence;
  videoFrameMapping?: VideoFrameMappingEvidence;
  photoRouting?: PhotoRoutingEvidence;
  priorPhotoRouting?: PhotoRoutingEvidence;
  photoArchiveRouting?: ArchiveRoutingEvidence;
  sceneCompatibility?: { status: 'native_headers_checked'; revision: string; cameraRecordChecked: boolean; poseRecordChecked: boolean;
    cameras: number | null; images: number | null; points: number | null;
    countAudit?: { method: 'viewer_native_text_parse'; checkedAt: string; viewerCommit: string;
      files: Partial<Record<'cameras' | 'images' | 'points3d', { path: string; count: number; bytes: number; sha256: string }>> } };
  sceneValidation?: { status: 'passed'; revision: string; cameras: number; images: number; points: number;
    photoCount: number; export: 'colmap_images' | 'colmap_model'; exportSha256: string } };
export type IndividualRecord = [id: string, source: number, kind: string, path: string, format: string, archive: string | null,
  files: Record<string, string> | null, proof: IndividualProof | null,
  inventory?: { listedAssets: number; linkedAssets: number; linksTruncated: boolean } | null, shareName?: string];
export interface IndividualPage { entries: CatalogSummary[]; total: number; page: number; pages: number; generation: string; feed?: FeedSelection }
export interface IndividualSelection { id: string; label: string; title: string; count: number; listingComplete: boolean; metadataUrl: string }
export const matchesIndividualDataset = (source: IndividualSource, value: string) => !value || source.id === value
  || (source.provider === 'public' && value === `public:${source.label}`);

/** Older filtered URLs remain usable after their redundant controls are retired. */
export function savedFilterSummary(filters: URLSearchParams): string {
  const delivery = filters.get('delivery');
  const labels = [delivery ? `Delivery: ${deliveryLabel(delivery)}` : '', filters.get('viewer') === 'available' ? 'Model links only' : ''].filter(Boolean);
  return labels.length ? `Saved filters: ${labels.join(' · ')}.` : '';
}

export function individualSelection(sources: IndividualSource[], value: string): IndividualSelection | null {
  if (!value) return null;
  const selected = sources.filter(source => matchesIndividualDataset(source, value));
  if (!selected.length) return null;
  const first = selected[0];
  return { id: first.id, label: first.label, title: selected.length === 1 ? first.title : `${selected.length} public source entries`,
    count: selected.reduce((sum, source) => sum + source.count, 0), listingComplete: selected.every(source => source.listingComplete),
    metadataUrl: selected.length === 1 ? `/hub/datasets/individual/sources/${first.id}.json` : '/hub/datasets/catalog.json' };
}

export function individualDatasetOptions(sources: IndividualSource[], selected: string): { value: string; label: string }[] {
  const options = new Map<string, { label: string; count: number }>();
  for (const source of sources) {
    if (!source.count && source.id !== selected) continue;
    const value = source.provider === 'public' ? `public:${source.label}` : source.id;
    const option = options.get(value) || { label: source.provider === 'public' ? source.label : `${source.label} · ${source.title}`, count: 0 };
    option.count += source.count;
    options.set(value, option);
    // Original source-specific URLs remain selectable as well as the grouped label.
    if (source.provider === 'public' && source.id === selected) options.set(source.id, { label: `${source.label} · ${source.title}`, count: source.count });
  }
  return [...options].sort(([, a], [, b]) => a.label.localeCompare(b.label, 'en')).map(([value, option]) => ({ value, label: `${option.label} (${option.count.toLocaleString('en-US')})` }));
}
export const INDIVIDUAL_PAGE_SIZE = 24;
export const individualKind = (kind: string, format = '') => kind === 'ply' && format === 'Gaussian PLY' ? 'Gaussian splat' : ({ colmap: 'COLMAP reconstruction', cameras: 'Cameras and poses', ply: 'PLY model',
  spz: 'Gaussian splat', sog: 'Gaussian splat', splat: 'Gaussian splat', ksplat: 'Gaussian splat', 'splat-scene': 'Gaussian scene',
  'camera-metadata': 'Camera metadata', 'camera-scene': 'Camera dataset', scene: 'Public scene' })[kind] || '3D geometry';
export const individualTokens = (text: string) => [...new Set(text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])];
const failedDelivery = new Set(['gated', 'access_denied', 'not_found', 'browser_request_failed', 'range_unverified', 'rate_limited', 'http_error']);

function hasCheckedSceneManifest(proof: IndividualProof | null | undefined): proof is IndividualProof & { sceneManifest: SceneManifestEvidence } {
  if (proof?.gaussianRouting) proof = { ...proof, viewerUrl: proof.gaussianRouting.baseViewerUrl };
  if (!proof || !isSceneManifestEvidence(proof.sceneManifest)) return false;
  const route = proof.videoFrameRouting;
  const mapping = proof.videoFrameMapping;
  if (proof.photoAvailability === 'video_frames' && !route && !mapping) return false;
  if (mapping ? !manifestViewerUrlMatches(proof.viewerUrl, mapping)
    : route ? !isVideoFrameRoutingEvidence(route, proof.sceneManifest) || proof.photoAvailability !== 'video_frames'
      || !manifestViewerUrlMatches(proof.viewerUrl, route) : !manifestViewerUrlMatches(proof.viewerUrl, proof.sceneManifest)) return false;
  const native = proof.sceneCompatibility ?? proof.sceneValidation;
  const original = proof.sceneManifest.sourceCounts ?? proof.sceneManifest.counts;
  return native?.cameras === original.cameras && native.images === original.images
    && (['xyz_ply', 'numpy_frame', 'archive_xyz_ply'].includes(proof.sceneManifest.pointFormat)
      || proof.sceneManifest.pointAssociation?.method === 'identical_native_model'
      ? native.points === 0 : native.points === proof.sceneManifest.counts.points);
}

export function canOpenIndividual(row: IndividualRecord, source: IndividualSource): boolean {
  const [, , kind, path, , archive, files, storedProof] = row;
  let proof = storedProof;
  if (proof?.gaussianRouting !== undefined) {
    if (!isGaussianRoutingEvidence(proof.gaussianRouting, source.sourceId,
      proof.sceneCompatibility?.revision ?? proof.sceneValidation?.revision, kind, path, files, proof.viewerUrl)) return false;
    proof = { ...proof, viewerUrl: proof.gaussianRouting.baseViewerUrl };
  }
  if (source.access !== 'public' || archive || proof?.opening || failedDelivery.has(proof?.delivery || '')) return false;
  if (['conversion_needed', 'no_native_assets', 'unavailable'].includes(proof?.level || '')) return false;
  if (proof?.sampleScope === 'companion_asset') return false;
  const compatibility = proof?.sceneCompatibility;
  const mapping = proof?.videoFrameMapping;
  if (mapping !== undefined && (!isVideoFrameMappingEvidence(mapping, files,
    compatibility?.images ?? proof?.sceneValidation?.images, compatibility?.revision ?? proof?.sceneValidation?.revision)
    || !manifestViewerUrlMatches(proof?.viewerUrl, mapping) || proof?.videoFrameRouting || proof?.photoRouting || proof?.photoArchiveRouting
    || proof?.photoAvailability !== (mapping.mappedImages === mapping.registeredImages ? 'video_frames' : 'partial'))) return false;
  if (proof?.sceneManifest !== undefined && !hasCheckedSceneManifest(proof)) return false;
  if ((proof?.videoFrameRouting !== undefined || proof?.photoAvailability === 'video_frames' && !mapping) && !hasCheckedSceneManifest(proof)) return false;
  if (proof?.photoArchiveRouting !== undefined && (!isArchiveRoutingEvidence(proof.photoArchiveRouting)
    || !photoRoutingUrlMatches(proof.viewerUrl, proof.photoArchiveRouting) || proof.photoRouting || proof.sceneManifest || proof.sceneValidation
    || !['colmap', 'cameras'].includes(kind) || proof.photoAvailability !== 'companion_archive')) return false;
  if (proof?.photoRouting !== undefined && (!isPhotoRoutingEvidence(proof.photoRouting)
    || !photoRoutingUrlMatches(proof.viewerUrl, proof.photoRouting) || proof.sceneManifest || proof.sceneValidation
    || !['colmap', 'cameras'].includes(kind)
    || compatibility?.images != null && compatibility.images !== proof.photoRouting.nameCheck.registered)) return false;
  if (['colmap', 'cameras'].includes(kind) && proof?.level === 'native_layout_checked' && proof.viewerUrl
    && ['browser_readable', 'cors_headers_checked'].includes(proof.delivery) && compatibility?.status === 'native_headers_checked'
    && [compatibility.cameras, compatibility.images].every(value => value === null || Number.isInteger(value) && value > 0)
    && compatibility.cameraRecordChecked === true && compatibility.poseRecordChecked === true
    && (kind !== 'cameras' || compatibility.points === 0)) return true;
  const validation = proof?.sceneValidation;
  return ['colmap', 'cameras', 'camera-scene', 'scene'].includes(kind) && proof?.level === 'scene_verified'
    && proof.delivery === 'browser_readable' && Boolean(proof.viewerUrl) && validation?.status === 'passed'
    && Number.isInteger(validation.cameras) && validation.cameras > 0
    && ['colmap_images', 'colmap_model'].includes(validation.export) && Number.isInteger(validation.images) && validation.images > 0;
}

export function individualSummary(row: IndividualRecord, source: IndividualSource): CatalogSummary {
  const [id, , kind, path, format, archive, , proof] = row;
  const selectedKind = hasCheckedSceneManifest(proof) && proof.sceneManifest.frameGeometry?.role === 'splat' ? 'splat-scene'
    : kind === 'cameras' && hasCheckedSceneManifest(proof) && proof.sceneManifest.counts.points > 0 ? 'colmap' : kind;
  const kindLabel = individualKind(selectedKind, format);
  const gated = source.access === 'gated' || proof?.delivery === 'gated';
  const statusLabel = gated ? 'Access required' : proof?.statusLabel || (archive ? 'Extraction required; load unverified' : 'Files listed; load not checked');
  const title = proof?.sceneTitle || (['colmap', 'cameras'].includes(kind) ? path.replace(/(?:^|\/)(?:(?:colmap\/)?sparse(?:\/\d+)?|known_pose_model|triangulated_model|triangulated_text)$/i, '') || source.label : path || source.label);
  return { id, title: title || 'Root reconstruction', provider: source.provider,
    ...(row[9] && CATALOG_SHARE_NAME.test(row[9]) ? { shareName: row[9] } : {}),
    ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
    license: source.license, licenseCategory: licenseCategory(source), access: source.access, statusLabel, formats: [format], testOrFixture: false,
    dataset: { id: source.id, label: source.label, title: source.title }, itemKind: kindLabel,
    ...(proof?.photoAvailability ? { photoStatus: proof.photoAvailability } : {}),
    ...(proof?.videoFrameRouting ? { videoCapture: proof.videoFrameRouting.captureType ?? 'synchronized_multiview' }
      : proof?.videoFrameMapping ? { videoCapture: proof.videoFrameMapping.captureType ?? 'unclassified' } : {}),
    ...(proof?.availableData ? { availableData: proof.availableData } : {}),
    ...(proof?.thumbnail ? { thumbnail: proof.thumbnail } : {}),
    sceneStats: sceneStatistics(hasCheckedSceneManifest(proof) ? proof.sceneManifest.counts
      : proof?.sceneValidation ?? proof?.sceneCompatibility),
    // The public JSON contract remains compatible with older pinned clients.
    ...(canOpenIndividual(row, source) ? { openUrl: `/hub/datasets/open/${id}` } : {}),
    description: gated ? 'The source lists this model, but its files require access and cannot be downloaded anonymously. File compatibility and complete loading remain unverified.'
      : proof?.summary || `${kindLabel} listed in ${source.title}${archive ? ` inside ${archive}; extract it before attempting to load this model` : ''}. This individual model has not passed a complete load check.`,
    delivery: gated ? 'gated' : proof?.delivery || 'not_tested', hasViewer: canOpenIndividual(row, source) && Boolean(proof?.viewerUrl) };
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export function individualEntry(row: IndividualRecord, source: IndividualSource, parent: CatalogEntry): CatalogEntry {
  const [id, , kind, path, , archive, files, proof] = row;
  const gated = source.access === 'gated' || parent.access === 'gated' || proof?.delivery === 'gated';
  const summary = individualSummary(row, gated ? { ...source, access: 'gated' } : source);
  const revision = parent.facts.find(fact => fact.label === 'Pinned revision')?.value;
  const repo = parent.sourceId.slice(3);
  const tree = (value: string) => `https://huggingface.co/datasets/${encodePath(repo)}/tree/${revision}${value ? `/${encodePath(value)}` : ''}`;
  const file = (value: string) => parent.provider === 'public' ? value : `https://huggingface.co/datasets/${encodePath(repo)}/resolve/${revision}/${encodePath(value)}`;
  const folder = ['colmap', 'cameras', 'camera-scene', 'splat-scene'].includes(kind);
  const dataUrl = parent.provider === 'public' ? parent.dataUrl : archive ? file(archive) : folder ? tree(path) : file(path);
  const canOpen = canOpenIndividual(row, gated ? { ...source, access: 'gated' } : source);
  const viewerUrl = canOpen ? proof?.viewerUrl : undefined;
  const verification: CatalogVerification = { ...(proof || { level: 'file_set_only', delivery: summary.delivery!, checkedAt: parent.checkedAt,
    summary: summary.description, scope: 'This model’s filenames only. Source-wide samples do not certify sibling models or their photos and masks.',
    viewerVersion: parent.verification?.viewerVersion || 'Not checked' }),
    ...(gated ? { delivery: 'gated', opening: { status: 'access_required' as const, summary: 'Obtain access and download this file on Hugging Face, then attempt local import. Direct gated loading and format compatibility have not been verified.' } }
      : archive ? { opening: { status: 'extraction_required' as const, summary: `Extract ${path || 'the selected model'} from the source archive before attempting to load this entry. Other archive members do not certify this model.` } } : {}) };
  return { ...parent, ...summary, id, sourceId: `${parent.sourceId}#${kind}:${archive || ''}:${path}`, sourceUrl: parent.provider === 'public' ? parent.sourceUrl
    : archive ? tree(archive.split('/').slice(0, -1).join('/')) : tree(folder ? path : path.split('/').slice(0, -1).join('/')),
    dataUrl, viewerUrl, candidateViewerUrl: undefined, modelManifest: undefined,
    availableData: summary.availableData, thumbnail: summary.thumbnail,
    status: proof ? `audited_${proof.level}` : 'individual_file_listing', verification,
    facts: [{ label: 'Dataset label', value: source.label }, { label: 'Source collection', value: source.title, url: `/hub/?dataset=${encodeURIComponent(source.id)}` },
      { label: 'Entry type', value: summary.itemKind! }, { label: 'Model path', value: path || '/' },
      ...(archive ? [{ label: 'Containing archive', value: archive }, { label: 'Opening this model', value: ['colmap', 'ply', 'spz', 'sog', 'splat', 'splat-scene'].includes(kind)
        ? `Extract the archive and select ${path || 'the root model folder'}. This entry’s loading evidence records the remaining checks.`
        : `Extract ${path || 'the scene'} and check its camera or geometry format. Conversion or a compatible importer may be needed before loading it in ColmapView.` }] : []),
      ...(revision ? [{ label: 'Pinned revision', value: revision }] : []),
      ...(summary.videoCapture ? [{ label: 'Video capture', value: VIDEO_CAPTURE_LABELS[summary.videoCapture] }] : []),
      ...(proof?.gaussianRouting && canOpen ? [
        { label: 'Gaussian companions', value: `${proof.gaussianRouting.assets.length.toLocaleString('en-US')} selectable sources; loaded on demand`, url: proof.gaussianRouting.url },
        ...proof.gaussianRouting.assets.slice(0, 6).map(asset => ({ label: asset.role === 'change_subset' ? 'Gaussian change subset' : 'Gaussian model',
          value: `${asset.path} · ${asset.gaussians.toLocaleString('en-US')} Gaussians`, url: asset.url })),
        { label: 'Gaussian check scope', value: 'Pinned format headers, counts and scene association checked. Alternatives, levels of detail and time samples stay separate. Sparse points and full-export evidence are unchanged.' },
      ] : []),
      ...(proof?.photoArchiveRouting && isArchiveRoutingEvidence(proof.photoArchiveRouting) ? [
        { label: 'Archive photo manifest', value: `${proof.photoArchiveRouting.format.toUpperCase()}; at least ${proof.photoArchiveRouting.photoLowerBound.toLocaleString('en-US')} photographs recorded. Members load as needed.`, url: proof.photoArchiveRouting.url },
        { label: 'Checked archive photograph', value: proof.photoArchiveRouting.sampleMemberPath },
        { label: 'Archive binding scope', value: 'One registered sample and its calibration checked. Complete photo coverage and export are separate checks.' },
      ] : []),
      ...(proof?.photoRouting && isPhotoRoutingEvidence(proof.photoRouting) ? [
        { label: 'Photo path manifest', value: `${proof.photoRouting.listedPhotos.toLocaleString('en-US')} photographs and ${proof.photoRouting.mappedNames.toLocaleString('en-US')} explicit name mappings at this revision`, url: proof.photoRouting.url },
        { label: 'Manifest photo bindings', value: `${proof.photoRouting.nameCheck.matched}/${proof.photoRouting.nameCheck.inspected} inspected registered names${proof.photoRouting.nameCheck.complete ? ' (all names inspected)' : ` from ${proof.photoRouting.nameCheck.registered ?? 'an unknown number of'} poses`}. Other photo bytes and full export checked separately.` },
        { label: 'Photo manifest viewer build', value: `${proof.photoRouting.viewerVersion} (${proof.photoRouting.viewerCommit})` },
        { label: 'Photo route checked on', value: proof.photoRouting.checkedAt },
      ] : []),
      ...(proof?.sceneManifest && isSceneManifestEvidence(proof.sceneManifest) ? [
        { label: proof.videoFrameRouting ? 'Model evidence manifest' : 'Scene manifest', value: proof.sceneManifest.frameGeometry ? 'Explicit v3 selected geometry frame' : 'Explicit v1 model and media selection', url: proof.sceneManifest.url },
        ...(proof.sceneManifest.pointSource ? [{ label: 'Selected point cloud', value: proof.sceneManifest.pointSource, url: file(proof.sceneManifest.pointSource) }] : []),
        { label: proof.videoFrameRouting ? 'Model-only export SHA-256' : 'Selected scene export SHA-256', value: proof.sceneManifest.exportSha256 },
        { label: 'Manifest viewer build', value: `${proof.sceneManifest.viewerVersion} (${proof.sceneManifest.viewerCommit})` },
        ...(proof.sceneManifest.frameGeometry ? [
          { label: 'Selected frame', value: `${proof.sceneManifest.frameGeometry.frame} from ${proof.sceneManifest.frameGeometry.frameCount.toLocaleString('en-US')} published frames` },
          { label: 'Selected geometry', value: `${proof.sceneManifest.frameGeometry.count.toLocaleString('en-US')} ${proof.sceneManifest.frameGeometry.role === 'splat' ? 'Gaussians (separate from COLMAP sparse points)' : 'untracked XYZ points'}` },
          { label: 'Geometry member', value: proof.sceneManifest.frameGeometry.memberPath, url: file(proof.sceneManifest.frameGeometry.sourcePath) },
          { label: 'Temporal scope', value: proof.videoFrameRouting
            ? 'One static frame with matching camera video frames loaded on demand. Sequence playback and archived masks are separate.'
            : 'One static frame. Video decoding, sequence playback and archived masks are outside this launch.' },
        ] : []),
        ...(proof.sceneManifest.frameIndices ? [{label: 'Selected temporal views', value: `${proof.sceneManifest.counts.images} of ${proof.sceneManifest.sourceCounts!.images} source frames`}]: []),
        ...(proof.sceneManifest.maskCount && proof.sceneManifest.maskRole === 'unknown'
          ? [{ label: 'Mask export', value: 'Masks display in the viewer. Their role is unverified, so they are not qualified as COLMAP feature masks.' }] : []),
      ] : []),
      ...(proof?.videoFrameRouting && proof.sceneManifest && isVideoFrameRoutingEvidence(proof.videoFrameRouting, proof.sceneManifest) ? [
        { label: 'Video frame manifest', value: `${proof.videoFrameRouting.count} camera videos at source time ${proof.videoFrameRouting.timestamp}s (geometry frame ${proof.videoFrameRouting.frame})`, url: proof.videoFrameRouting.url },
        { label: 'Video frame coverage', value: 'All registered names mapped. One frame per scene decoded at camera resolution; remaining pixels and full photo export checked separately.' },
        { label: 'Video frame viewer build', value: `${proof.videoFrameRouting.viewerVersion} (${proof.videoFrameRouting.viewerCommit})` },
      ] : []),
      ...(proof?.videoFrameMapping ? [
        { label: 'Video frame manifest', value: `${proof.videoFrameMapping.mappedImages.toLocaleString('en-US')} matched views from ${proof.videoFrameMapping.videoSources} source videos`, url: proof.videoFrameMapping.url },
        { label: 'Frame coverage', value: `${proof.videoFrameMapping.mappedImages} of ${proof.videoFrameMapping.registeredImages} registered names; ${proof.videoFrameMapping.sampleCount} decoded samples checked separately from full export` },
        { label: 'Temporal scope', value: proof.videoFrameMapping.temporalScope === 'per_pose' ? 'One matched frame at each registered pose’s source time' : 'Matched frames for one synchronized snapshot' },
        { label: 'Video frame viewer build', value: `${proof.videoFrameMapping.viewerVersion} (${proof.videoFrameMapping.viewerCommit})` },
      ] : []),
      ...(summary.availableData ? [{ label: 'Available data', value: sceneDataText(summary.availableData) },
        ...Object.entries(summary.availableData).filter(([, evidence]) => evidence?.samplePath).flatMap(([kind, evidence]) => [{
          label: `${kind.replaceAll('_', ' ')} sample`, value: evidence!.samplePath!, ...(parent.provider === 'public' ? {} : { url: file(evidence!.samplePath!) }),
        }, ...(evidence?.archiveMember ? [{ label: `${kind.replaceAll('_', ' ')} archive member`, value: evidence.archiveMember }] : []),
        ...(evidence?.requiresConversion ? [{ label: 'Splat loading', value: 'Compressed Gaussian PLY is supplied. Convert it to standard Gaussian PLY before importing; the current model link does not attach this asset.' }] : [])])] : []),
      ...(summary.thumbnail ? [{ label: 'Preview attribution', value: `${summary.thumbnail.attribution} · ${summary.thumbnail.license}. ${summary.thumbnail.crop === 'aspect_fit' ? 'Full-frame thumbnail' : 'Center-square crop'} of a ${summary.thumbnail.videoFrame ? 'mapped video frame' : 'checked registered image'}.` },
        { label: 'Preview source', value: summary.thumbnail.sourcePath, ...(summary.thumbnail.sourceArchive ? {} : { url: file(summary.thumbnail.sourcePath) }) },
        ...(summary.thumbnail.sourceArchive ? [{ label: 'Preview source archive', value: summary.thumbnail.sourceArchive, url: file(summary.thumbnail.sourceArchive) }] : [])] : []),
      ...(proof?.photoAvailability ? [{ label: proof.videoFrameMapping || proof.videoFrameRouting ? 'Camera imagery' : 'Original photographs', value: proof.photoAvailability === 'complete_export_checked'
        ? 'All registered originals checked in a complete export' : proof.photoAvailability === 'not_included'
          ? 'Not included by publisher' : photoLabel(proof.photoAvailability) }] : []),
      ...(proof?.calibrationReview ? [{ label: 'Calibration review', value: proof.calibrationReview.summary },
        { label: 'Reviewed camera file SHA-256', value: proof.calibrationReview.cameraFileSha256 },
        { label: 'Calibration reviewed on', value: proof.calibrationReview.checkedAt }] : []),
      ...(proof?.sourceIntegrityReview ? [{ label: 'Source feature links', value: proof.sourceIntegrityReview.summary },
        { label: 'Relationship check scope', value: proof.sourceIntegrityReview.scope === 'complete_model' ? 'Complete original model' : 'Bounded original-file samples; remaining relationships unverified' },
        { label: 'Feature links reviewed on', value: proof.sourceIntegrityReview.checkedAt },
        { label: 'Relationship audit receipt SHA-256', value: proof.sourceIntegrityReview.receiptSha256 }] : []),
      ...(proof?.photoAudit ? [
        { label: 'Image availability check', value: proof.photoAudit.summary },
        ...(!proof.videoFrameMapping && !proof.videoFrameRouting ? [{ label: 'Current media scope', value: proof.photoAudit.sceneRoot || '(repository root)' }] : []),
        ...(proof.photoAudit.mediaScope !== undefined ? [{ label: 'Required photo scope', value: proof.photoAudit.mediaScope || '(repository root)' }] : []),
        ...(proof.photoAudit.photoCollection ? [{ label: 'Photo collection', value: proof.photoAudit.photoCollection }] : []),
        ...(proof.photoAudit.mappingFile ? [{ label: 'Image-name mapping', value: proof.photoAudit.mappingFile, url: file(proof.photoAudit.mappingFile) }] : []),
        ...(proof.photoAudit.associationFile ? [{ label: 'Photo association manifest', value: proof.photoAudit.associationFile, url: file(proof.photoAudit.associationFile) }] : []),
        ...(proof.photoAudit.mappingCheck ? [{ label: 'Listed mapping targets', value: `${proof.photoAudit.mappingCheck.matched}/${proof.photoAudit.mappingCheck.entries}. Mapping coverage is separate from checking every registered name.` }] : []),
        ...(proof.photoAudit.nameCheck ? [{ label: proof.photoAudit.nameCheck.scope === 'prefix' ? 'Sampled image names matched' : 'Registered image names matched',
          value: proof.photoAudit.nameCheck.scope === 'prefix'
            ? `${proof.photoAudit.nameCheck.matched}/${proof.photoAudit.nameCheck.registered} inspected names from ${proof.photoAudit.nameCheck.totalRegistered} registered poses. This prefix sample does not establish complete coverage.`
            : `${proof.photoAudit.nameCheck.matched}/${proof.photoAudit.nameCheck.registered} through the current loader; image pixels and complete export checked separately.` }] : []),
        ...(proof.photoAudit.proposedNameCheck ? [{ label: 'Photo names matched with proposed scope', value: `${proof.photoAudit.proposedNameCheck.matched}/${proof.photoAudit.proposedNameCheck.registered}. This media configuration is not applied by the current scene link.` }] : []),
        ...(proof.photoAudit.samplePath ? [{ label: 'Checked photo sample', value: proof.photoAudit.samplePath, url: file(proof.photoAudit.samplePath) },
          { label: 'Photo sample browser read', value: proof.photoAudit.samplePixels === 'decoded' ? 'Photograph pixels decoded; other images checked separately.' : 'Photograph bytes readable; pixel decoding deferred by the audit size bound.' }] : []),
        ...(proof.photoAudit.sampleCalibration ? [{ label: 'Photo / camera resolution',
          value: `${proof.photoAudit.sampleWidth} × ${proof.photoAudit.sampleHeight} / ${proof.photoAudit.sampleCalibration.width} × ${proof.photoAudit.sampleCalibration.height} pixels` },
          { label: 'Photo alignment', value: proof.photoAudit.sampleDimensionsMatch
            ? 'Sample dimensions match; complete coverage and export checked separately.'
            : 'Sample dimensions differ. The image-to-camera resolution mapping remains unverified.' }] : []),
        ...(proof.photoAudit.archive ? [{ label: 'Separate image archive', value: proof.photoAudit.archive.path, url: file(proof.photoAudit.archive.path) },
          { label: 'Archive photo evidence', value: `${proof.photoAudit.archive.inventoryComplete === false ? 'At least ' : ''}${proof.photoAudit.archive.photos} image member${proof.photoAudit.archive.photos === 1 ? '' : 's'} listed; a registered name matched; browser range read checked. Every image and combined scene loading remain separate checks.` },
          ...(proof.photoAudit.archive.sample ? [{ label: 'Checked archive photograph', value: `${proof.photoAudit.archive.sample.path} → ${proof.photoAudit.archive.sample.registeredName}. Photograph pixels decoded; ${proof.photoAudit.archive.sample.dimensionsMatch ? 'camera dimensions match' : 'camera dimensions differ; calibration or image conversion needs review'}.` }] : [])] : []),
        ...(proof.photoAudit.policyNote ? [{ label: 'Photo path policy', value: proof.photoAudit.policyNote }] : []),
        { label: 'Images checked on', value: proof.photoAudit.checkedAt },
      ] : []),
      ...(proof?.sceneCompatibility ? [{ label: 'Native layout check', value: proof.scope },
        ...Object.entries({ 'Camera definitions': proof.sceneCompatibility.cameras, 'Registered pose records': proof.sceneCompatibility.images,
          [proof.sceneManifest ? 'Native 3D points' : '3D points']: proof.sceneCompatibility.points }).filter(([, value]) => value !== null).map(([label, value]) => ({ label, value: String(value) }))] : []),
      ...(proof?.sceneCompatibility?.countAudit ? [{ label: 'Scene statistics check', value: `Complete text files (${Object.values(proof.sceneCompatibility.countAudit.files).map(file => file!.path.split('/').at(-1)).join(', ')}) parsed with ColmapView’s native readers on ${proof.sceneCompatibility.countAudit.checkedAt}. Photograph availability is checked separately.` }] : []),
      ...(proof?.sceneValidation ? [...(proof.sceneValidation.export === 'colmap_images' ? [{ label: 'Verified original photographs', value: String(proof.sceneValidation.photoCount) }] : []),
        { label: 'Verified camera models', value: String(proof.sceneValidation.cameras) },
        { label: proof.sceneValidation.export === 'colmap_images' ? 'COLMAP + images export SHA-256' : 'COLMAP model export SHA-256', value: proof.sceneValidation.exportSha256 },
        { label: 'Scene verified on', value: proof.checkedAt }] : []),
      ...(proof?.companionPointCloud ? [{ label: 'Imported XYZ point cloud (no feature tracks)', value: proof.companionPointCloud, url: file(proof.companionPointCloud) }] : []),
      ...(parent.verification?.sourceImages ? [{ label: 'Source RGB', value: parent.verification.sourceImages.summary, url: parent.verification.sourceImages.sourceUrl }] : []),
      ...(row[8] ? [{ label: 'Scene assets listed', value: String(row[8].listedAssets) },
        { label: 'Scene asset links', value: row[8].linksTruncated ? `Showing ${row[8].linkedAssets} asset links. Use the source scene folder for all ${row[8].listedAssets} listed assets.` : 'Recorded scene asset links are shown below; source photographs, masks and uninspected archives need separate checks.' }] : []),
      { label: 'Collection enumeration', value: source.listingComplete ? 'Listed model paths enumerated; uninspected archives may contain more models.' : 'Source listing is incomplete; additional models may exist.' },
      ...Object.entries(files || {}).map(([role, value]) => ({ label: value === proof?.companionPointCloud ? 'Verified point source' : role.startsWith('asset:') ? 'Companion model asset (not separately checked)' : `${role} file`, value, ...(archive || parent.provider === 'public' ? {} : { url: file(value) }) })),
      ...(kind === 'scene' ? parent.facts : [])],
    audits: [{ sourceId: id, checkedAt: verification.checkedAt, scope: 'source', facts: [{ label: 'Individual model evidence', value: verification.summary },
      { label: 'Scope', value: verification.scope }] }, ...parent.audits.map(audit => ({ ...audit, scope: 'collection' as const }))] };
}

