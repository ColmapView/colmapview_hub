import type { CatalogEntry, CatalogSummary, CatalogVerification } from './catalog';
import { licenseCategory } from './license-categories';
import type { LicenseCategory } from './license-categories';

export interface IndividualSource {
  id: string; sourceId: string; title: string; label: string;
  provider: CatalogEntry['provider']; license: string; licenseCategory?: LicenseCategory; access: CatalogEntry['access'];
  start: number; count: number; listingComplete: boolean;
}
export interface IndividualIndex {
  schemaVersion: 1; generation: string; total: number; packSize: number; checkedAt: string;
  sources: IndividualSource[];
  facets: Record<string, Record<string, { file: string; count: number }>>;
  kinds: Record<string, number>; levels: Record<string, number>; delivery: Record<string, number>;
  incompleteCollections: number; scope: string;
}
export type IndividualProof = CatalogVerification & { statusLabel: string; viewerUrl?: string };
export type IndividualRecord = [id: string, source: number, kind: string, path: string, format: string, archive: string | null,
  files: Record<string, string> | null, proof: IndividualProof | null];
export interface IndividualPage { entries: CatalogSummary[]; total: number; page: number; pages: number; generation: string }
export interface IndividualSelection { id: string; label: string; title: string; count: number; listingComplete: boolean; metadataUrl: string }
export const matchesIndividualDataset = (source: IndividualSource, value: string) => !value || source.id === value
  || (source.provider === 'public' && value === `public:${source.label}`);

export function individualSelection(sources: IndividualSource[], value: string): IndividualSelection | null {
  if (!value) return null;
  const selected = sources.filter(source => matchesIndividualDataset(source, value));
  if (!selected.length) return null;
  const first = selected[0];
  return { id: first.id, label: first.label, title: selected.length === 1 ? first.title : `${selected.length} public source entries`,
    count: selected.reduce((sum, source) => sum + source.count, 0), listingComplete: selected.every(source => source.listingComplete),
    metadataUrl: selected.length === 1 ? `/hub/datasets/${first.id}` : `/hub/datasets/collections?provider=public&q=${encodeURIComponent(first.label)}` };
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
  spz: 'Gaussian splat', sog: 'Gaussian splat', splat: 'Gaussian splat', ksplat: 'Gaussian splat', 'splat-scene': 'Gaussian splat',
  'camera-metadata': 'Camera metadata', scene: 'Public scene' })[kind] || '3D geometry';
export const individualTokens = (text: string) => [...new Set(text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])];

export function individualSummary(row: IndividualRecord, source: IndividualSource): CatalogSummary {
  const [id, , kind, path, format, archive, , proof] = row;
  const kindLabel = individualKind(kind, format);
  const statusLabel = proof?.statusLabel || 'Files listed; load not checked';
  const title = kind === 'colmap' ? path.replace(/(?:^|\/)(?:colmap\/)?sparse\/0$/i, '') || 'Root reconstruction' : path;
  return { id, title: title || 'Root reconstruction', provider: source.provider,
    license: source.license, licenseCategory: licenseCategory(source), access: source.access, statusLabel, formats: [format], testOrFixture: false,
    dataset: { id: source.id, label: source.label, title: source.title }, itemKind: kindLabel,
    description: proof?.summary || `${kindLabel} listed in ${source.title}${archive ? ` inside ${archive}` : ''}. This individual model has not passed a complete load check.`,
    delivery: proof?.delivery || (source.access === 'gated' ? 'gated' : 'not_tested'), hasViewer: Boolean(proof?.viewerUrl) };
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
export function individualEntry(row: IndividualRecord, source: IndividualSource, parent: CatalogEntry): CatalogEntry {
  const [id, , kind, path, , archive, files, proof] = row;
  const summary = individualSummary(row, source);
  const revision = parent.facts.find(fact => fact.label === 'Pinned revision')?.value;
  const repo = parent.sourceId.slice(3);
  const tree = (value: string) => `https://huggingface.co/datasets/${encodePath(repo)}/tree/${revision}${value ? `/${encodePath(value)}` : ''}`;
  const file = (value: string) => `https://huggingface.co/datasets/${encodePath(repo)}/resolve/${revision}/${encodePath(value)}`;
  const folder = ['colmap', 'cameras', 'splat-scene'].includes(kind);
  const dataUrl = parent.provider === 'public' ? parent.dataUrl : archive ? file(archive) : folder ? tree(path) : file(path);
  const candidate = !proof?.viewerUrl && !archive && parent.provider === 'huggingface' && parent.access === 'public'
    && ['colmap', 'ply', 'spz', 'sog', 'splat'].includes(kind) && !['conversion_needed', 'no_native_assets', 'unavailable'].includes(proof?.level || '')
    ? `https://colmapview.opsiclear.com/?url=${encodeURIComponent(dataUrl!)}` : undefined;
  const verification: CatalogVerification = proof || { level: 'file_set_only', delivery: summary.delivery!, checkedAt: parent.checkedAt,
    summary: summary.description, scope: 'This model’s filenames only. Source-wide samples do not certify sibling models or their photos and masks.',
    viewerVersion: parent.verification?.viewerVersion || 'Not checked' };
  return { ...parent, ...summary, id, sourceId: `${parent.sourceId}#${kind}:${archive || ''}:${path}`, sourceUrl: parent.provider === 'public' ? parent.sourceUrl
    : archive ? tree(archive.split('/').slice(0, -1).join('/')) : tree(folder ? path : path.split('/').slice(0, -1).join('/')),
    dataUrl, viewerUrl: proof?.viewerUrl, candidateViewerUrl: candidate, modelManifest: undefined,
    status: proof ? `audited_${proof.level}` : 'individual_file_listing', verification,
    facts: [{ label: 'Dataset label', value: source.label }, { label: 'Source collection', value: source.title, url: `/hub/datasets/${source.id}` },
      { label: 'Entry type', value: summary.itemKind! }, { label: 'Model path', value: path || '/' },
      ...(archive ? [{ label: 'Containing archive', value: archive }, { label: 'Opening this model', value: ['colmap', 'ply', 'spz', 'sog', 'splat', 'splat-scene'].includes(kind)
        ? `Extract the archive and select ${path || 'the root model folder'}. This entry’s loading evidence records the remaining checks.`
        : `Extract ${path || 'the scene'} and check its camera or geometry format. Conversion or a compatible importer may be needed before loading it in ColmapView.` }] : []),
      ...(revision ? [{ label: 'Pinned revision', value: revision }] : []),
      { label: 'Collection enumeration', value: source.listingComplete ? 'Listed model paths enumerated; uninspected archives may contain more models.' : 'Source listing is incomplete; additional models may exist.' },
      ...Object.entries(files || {}).map(([role, value]) => ({ label: role.startsWith('asset:') ? 'Companion model asset (not separately checked)' : `${role} file`, value, ...(archive || parent.provider === 'public' ? {} : { url: file(value) }) })),
      ...(kind === 'scene' ? parent.facts : [])],
    audits: [{ sourceId: id, checkedAt: verification.checkedAt, scope: 'source', facts: [{ label: 'Individual model evidence', value: verification.summary },
      { label: 'Scope', value: verification.scope }] }, ...parent.audits.map(audit => ({ ...audit, scope: 'collection' as const }))] };
}

