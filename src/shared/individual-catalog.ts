import type { CatalogEntry, CatalogSummary, CatalogVerification } from './catalog';
import { deliveryLabel } from './catalog';
import { licenseCategory } from './license-categories';
import type { LicenseCategory } from './license-categories';
import { photoLabel } from './scene-photos';
import type { PhotoStatus } from './scene-photos';
import { sceneDataText, sceneStatistics } from './scene-contents';
import { isSceneManifestEvidence, manifestViewerUrlMatches } from './scene-manifests';
import type { SceneManifestEvidence } from './scene-manifests';

export interface IndividualSource {
  id: string; sourceId: string; title: string; label: string;
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
  incompleteCollections: number; scope: string;
}
export type IndividualProof = CatalogVerification & { statusLabel: string; viewerUrl?: string; sampleScope?: 'companion_asset';
  sceneManifest?: SceneManifestEvidence;
  sceneCompatibility?: { status: 'native_headers_checked'; revision: string; cameraRecordChecked: boolean; poseRecordChecked: boolean;
    cameras: number | null; images: number | null; points: number | null;
    countAudit?: { method: 'viewer_native_text_parse'; checkedAt: string; viewerCommit: string;
      files: Partial<Record<'cameras' | 'images' | 'points3d', { path: string; count: number; bytes: number; sha256: string }>> } };
  sceneValidation?: { status: 'passed'; revision: string; cameras: number; images: number; points: number;
    photoCount: number; export: 'colmap_images' | 'colmap_model'; exportSha256: string } };
export type IndividualRecord = [id: string, source: number, kind: string, path: string, format: string, archive: string | null,
  files: Record<string, string> | null, proof: IndividualProof | null,
  inventory?: { listedAssets: number; linkedAssets: number; linksTruncated: boolean }];
export interface IndividualPage { entries: CatalogSummary[]; total: number; page: number; pages: number; generation: string }
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
  if (!proof || !isSceneManifestEvidence(proof.sceneManifest) || !manifestViewerUrlMatches(proof.viewerUrl, proof.sceneManifest)) return false;
  const native = proof.sceneCompatibility ?? proof.sceneValidation;
  return native?.cameras === proof.sceneManifest.counts.cameras && native.images === proof.sceneManifest.counts.images
    && (proof.sceneManifest.pointFormat === 'xyz_ply' ? native.points === 0 : native.points === proof.sceneManifest.counts.points);
}

export function canOpenIndividual(row: IndividualRecord, source: IndividualSource): boolean {
  const [, , kind, , , archive, , proof] = row;
  if (source.access !== 'public' || archive || proof?.opening || failedDelivery.has(proof?.delivery || '')) return false;
  if (['conversion_needed', 'no_native_assets', 'unavailable'].includes(proof?.level || '')) return false;
  if (proof?.sampleScope === 'companion_asset') return false;
  const compatibility = proof?.sceneCompatibility;
  if (proof?.sceneManifest !== undefined && !hasCheckedSceneManifest(proof)) return false;
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
  const kindLabel = individualKind(kind, format);
  const gated = source.access === 'gated' || proof?.delivery === 'gated';
  const statusLabel = gated ? 'Access required' : proof?.statusLabel || (archive ? 'Extraction required; load unverified' : 'Files listed; load not checked');
  const title = ['colmap', 'cameras'].includes(kind) ? path.replace(/(?:^|\/)(?:(?:colmap\/)?sparse(?:\/\d+)?|known_pose_model|triangulated_model|triangulated_text)$/i, '') || source.label : path || source.label;
  return { id, title: title || 'Root reconstruction', provider: source.provider,
    license: source.license, licenseCategory: licenseCategory(source), access: source.access, statusLabel, formats: [format], testOrFixture: false,
    dataset: { id: source.id, label: source.label, title: source.title }, itemKind: kindLabel,
    ...(proof?.photoAvailability ? { photoStatus: proof.photoAvailability } : {}),
    ...(proof?.availableData ? { availableData: proof.availableData } : {}),
    ...(proof?.thumbnail ? { thumbnail: proof.thumbnail } : {}),
    sceneStats: sceneStatistics(hasCheckedSceneManifest(proof) ? proof.sceneManifest.counts
      : proof?.sceneValidation ?? proof?.sceneCompatibility),
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
    facts: [{ label: 'Dataset label', value: source.label }, { label: 'Source collection', value: source.title, url: `/hub/datasets/${source.id}` },
      { label: 'Entry type', value: summary.itemKind! }, { label: 'Model path', value: path || '/' },
      ...(archive ? [{ label: 'Containing archive', value: archive }, { label: 'Opening this model', value: ['colmap', 'ply', 'spz', 'sog', 'splat', 'splat-scene'].includes(kind)
        ? `Extract the archive and select ${path || 'the root model folder'}. This entry’s loading evidence records the remaining checks.`
        : `Extract ${path || 'the scene'} and check its camera or geometry format. Conversion or a compatible importer may be needed before loading it in ColmapView.` }] : []),
      ...(revision ? [{ label: 'Pinned revision', value: revision }] : []),
      ...(proof?.sceneManifest && isSceneManifestEvidence(proof.sceneManifest) ? [
        { label: 'Scene manifest', value: 'Explicit v1 model and media selection', url: proof.sceneManifest.url },
        ...(proof.sceneManifest.pointSource ? [{ label: 'Selected point cloud', value: proof.sceneManifest.pointSource, url: file(proof.sceneManifest.pointSource) }] : []),
        { label: 'Selected scene export SHA-256', value: proof.sceneManifest.exportSha256 },
        { label: 'Manifest viewer build', value: `${proof.sceneManifest.viewerVersion} (${proof.sceneManifest.viewerCommit})` },
        ...(proof.sceneManifest.maskCount && proof.sceneManifest.maskRole === 'unknown'
          ? [{ label: 'Mask export', value: 'Masks display in the viewer. Their role is unverified, so they are not qualified as COLMAP feature masks.' }] : []),
      ] : []),
      ...(summary.availableData ? [{ label: 'Available data', value: sceneDataText(summary.availableData) },
        ...Object.entries(summary.availableData).filter(([, evidence]) => evidence?.samplePath).map(([kind, evidence]) => ({
          label: `${kind.replaceAll('_', ' ')} sample`, value: evidence!.samplePath!, ...(parent.provider === 'public' ? {} : { url: file(evidence!.samplePath!) }),
        }))] : []),
      ...(summary.thumbnail ? [{ label: 'Preview attribution', value: `${summary.thumbnail.attribution} · ${summary.thumbnail.license}. Center-square crop of the first available registered photograph.` },
        { label: 'Preview original', value: summary.thumbnail.sourcePath, ...(summary.thumbnail.sourceArchive ? {} : { url: file(summary.thumbnail.sourcePath) }) },
        ...(summary.thumbnail.sourceArchive ? [{ label: 'Preview source archive', value: summary.thumbnail.sourceArchive, url: file(summary.thumbnail.sourceArchive) }] : [])] : []),
      ...(proof?.photoAvailability ? [{ label: 'Original photographs', value: proof.photoAvailability === 'complete_export_checked'
        ? 'All registered originals checked in a complete export' : proof.photoAvailability === 'not_included'
          ? 'Not included by publisher' : photoLabel(proof.photoAvailability) }] : []),
      ...(proof?.photoAudit ? [
        { label: 'Photo availability check', value: proof.photoAudit.summary },
        { label: 'Current media scope', value: proof.photoAudit.sceneRoot || '(repository root)' },
        ...(proof.photoAudit.mediaScope !== undefined ? [{ label: 'Required photo scope', value: proof.photoAudit.mediaScope || '(repository root)' }] : []),
        ...(proof.photoAudit.photoCollection ? [{ label: 'Photo collection', value: proof.photoAudit.photoCollection }] : []),
        ...(proof.photoAudit.mappingFile ? [{ label: 'Image-name mapping', value: proof.photoAudit.mappingFile, url: file(proof.photoAudit.mappingFile) }] : []),
        ...(proof.photoAudit.associationFile ? [{ label: 'Photo association manifest', value: proof.photoAudit.associationFile, url: file(proof.photoAudit.associationFile) }] : []),
        ...(proof.photoAudit.mappingCheck ? [{ label: 'Listed mapping targets', value: `${proof.photoAudit.mappingCheck.matched}/${proof.photoAudit.mappingCheck.entries}. Mapping coverage is separate from checking every registered name.` }] : []),
        ...(proof.photoAudit.nameCheck ? [{ label: 'Registered photo names matched', value: `${proof.photoAudit.nameCheck.matched}/${proof.photoAudit.nameCheck.registered} through the current loader; photograph bytes and complete export checked separately.` }] : []),
        ...(proof.photoAudit.proposedNameCheck ? [{ label: 'Photo names matched with proposed scope', value: `${proof.photoAudit.proposedNameCheck.matched}/${proof.photoAudit.proposedNameCheck.registered}. This media configuration is not applied by the current scene link.` }] : []),
        ...(proof.photoAudit.samplePath ? [{ label: 'Checked photo sample', value: proof.photoAudit.samplePath, url: file(proof.photoAudit.samplePath) },
          { label: 'Photo sample browser read', value: proof.photoAudit.samplePixels === 'decoded' ? 'Photograph pixels decoded; other images checked separately.' : 'Photograph bytes readable; pixel decoding deferred by the audit size bound.' }] : []),
        ...(proof.photoAudit.archive ? [{ label: 'Separate image archive', value: proof.photoAudit.archive.path, url: file(proof.photoAudit.archive.path) },
          { label: 'Archive photo evidence', value: `${proof.photoAudit.archive.photos} image members listed; first registered name matched; browser range read checked. Every image and combined scene loading remain separate checks.` }] : []),
        ...(proof.photoAudit.policyNote ? [{ label: 'Photo path policy', value: proof.photoAudit.policyNote }] : []),
        { label: 'Photos checked on', value: proof.photoAudit.checkedAt },
      ] : []),
      ...(proof?.sceneCompatibility ? [{ label: 'Native layout check', value: proof.scope },
        ...Object.entries({ 'Camera definitions': proof.sceneCompatibility.cameras, 'Registered pose records': proof.sceneCompatibility.images,
          [proof.sceneManifest ? 'Native 3D points' : '3D points']: proof.sceneCompatibility.points }).filter(([, value]) => value !== null).map(([label, value]) => ({ label, value: String(value) }))] : []),
      ...(proof?.sceneCompatibility?.countAudit ? [{ label: 'Scene statistics check', value: `Complete text files (${Object.values(proof.sceneCompatibility.countAudit.files).map(file => file!.path.split('/').at(-1)).join(', ')}) parsed with ColmapView’s native readers on ${proof.sceneCompatibility.countAudit.checkedAt}. Photograph availability is checked separately.` }] : []),
      ...(proof?.sceneValidation ? [...(proof.sceneValidation.export === 'colmap_images' ? [{ label: 'Verified original photographs', value: String(proof.sceneValidation.photoCount) }] : []),
        { label: 'Verified camera models', value: String(proof.sceneValidation.cameras) },
        { label: proof.sceneValidation.export === 'colmap_images' ? 'COLMAP + images export SHA-256' : 'COLMAP model export SHA-256', value: proof.sceneValidation.exportSha256 },
        { label: 'Scene verified on', value: proof.checkedAt }] : []),
      ...(parent.verification?.sourceImages ? [{ label: 'Source RGB', value: parent.verification.sourceImages.summary, url: parent.verification.sourceImages.sourceUrl }] : []),
      ...(row[8] ? [{ label: 'Scene assets listed', value: String(row[8].listedAssets) },
        { label: 'Scene asset links', value: row[8].linksTruncated ? `Showing ${row[8].linkedAssets} asset links. Use the source scene folder for all ${row[8].listedAssets} listed assets.` : 'Recorded scene asset links are shown below; source photographs, masks and uninspected archives need separate checks.' }] : []),
      { label: 'Collection enumeration', value: source.listingComplete ? 'Listed model paths enumerated; uninspected archives may contain more models.' : 'Source listing is incomplete; additional models may exist.' },
      ...Object.entries(files || {}).map(([role, value]) => ({ label: role.startsWith('asset:') ? 'Companion model asset (not separately checked)' : `${role} file`, value, ...(archive || parent.provider === 'public' ? {} : { url: file(value) }) })),
      ...(kind === 'scene' ? parent.facts : [])],
    audits: [{ sourceId: id, checkedAt: verification.checkedAt, scope: 'source', facts: [{ label: 'Individual model evidence', value: verification.summary },
      { label: 'Scope', value: verification.scope }] }, ...parent.audits.map(audit => ({ ...audit, scope: 'collection' as const }))] };
}

