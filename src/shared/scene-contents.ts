import { escapeHtml as escape } from './html';
import type { LicenseCategory } from './license-categories';
import type { PhotoStatus } from './scene-photos';

export const SCENE_DATA_LABELS = {
  images: 'Images', cameras: 'Cameras', point_cloud: 'Point cloud', splats: 'Splats', masks: 'Masks', meshes: 'Meshes', geometry: '3D models',
} as const;
export type SceneDataKind = keyof typeof SCENE_DATA_LABELS;
export type SceneDataStatus = 'checked' | 'listed' | 'needs_setup' | 'archive' | 'partial';
export type SceneContents = Partial<Record<SceneDataKind, { status: SceneDataStatus; count?: number; samplePath?: string;
  archiveMember?: string; archiveFormat?: 'zip' | 'tar.zst'; encoding?: 'compressed_ply'; requiresConversion?: true }>>;
export interface SceneStatistics { cameraPoses: number | null; cameraModels: number | null; points: number | null }
const statisticFields = [
  { key: 'cameraPoses', label: 'Camera poses', note: 'Registered camera poses in the selected reconstruction. Original photographs may be absent.' },
  { key: 'cameraModels', label: 'Camera models', note: 'Camera definitions in the selected reconstruction. Multiple poses can share one camera model.' },
  { key: 'points', label: '3D points', note: '3D points in the selected scene. A checked manifest can explicitly select a companion XYZ cloud.' },
] as const;

export function sceneStatistics(counts?: { images: number | null; cameras: number | null; points: number | null }): SceneStatistics {
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { cameraPoses: count(counts?.images), cameraModels: count(counts?.cameras), points: count(counts?.points) };
}

export function isSceneStatistics(value: unknown): value is SceneStatistics {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return statisticFields.every(({ key }) => Object.hasOwn(item, key)
    && (item[key] === null || typeof item[key] === 'number' && Number.isSafeInteger(item[key]) && item[key] >= 0));
}

export function sceneStatisticsHtml(statistics?: SceneStatistics, compact = false): string {
  if (!statistics) return '';
  const fields = compact ? statisticFields.filter(field => field.key !== 'cameraModels') : statisticFields;
  return `<dl class="dataset-statistics${compact ? ' dataset-statistics-compact' : ''}" aria-label="Scene statistics">` + fields.map(({ key, label, note }) => {
    const value = statistics[key];
    const title = compact ? key === 'cameraPoses' ? 'Cameras' : 'Points' : label;
    return `<div title="${note}"><dt>${title}</dt><dd data-stat="${key}">${value === null ? 'Unknown' : value.toLocaleString('en-US')}</dd></div>`;
  }).join('') + '</dl>';
}

export interface SceneThumbnail {
  url: string; width: 320; height: 320; sourcePath: string; sourceArchive?: string;
  sourceSha256: string; datasetLicense: string; license: string; attribution: string; crop: 'center_square';
  licenseUrl?: string; creditUrl?: string; registeredName?: string;
}
export const isThumbnailUrl = (value: unknown): value is string => typeof value === 'string'
  && /^\/hub\/datasets\/individual\/thumbnails\/[a-f0-9]{64}\.jpg$/.test(value);
const isCreditUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['creativecommons.org', 'commons.wikimedia.org'].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
};

export function isSceneThumbnail(value: unknown): value is SceneThumbnail {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return isThumbnailUrl(item.url) && item.width === 320 && item.height === 320 && item.crop === 'center_square'
    && ['sourcePath', 'sourceSha256', 'datasetLicense', 'license', 'attribution'].every(key => typeof item[key] === 'string' && item[key])
    && /^[a-f0-9]{64}$/.test(String(item.sourceSha256))
    && (item.sourceArchive === undefined || typeof item.sourceArchive === 'string')
    && (item.licenseUrl === undefined || isCreditUrl(item.licenseUrl)) && (item.creditUrl === undefined || isCreditUrl(item.creditUrl));
}

export function isSceneContents(value: unknown): value is SceneContents {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([kind, item]: [string, unknown]) => {
    if (!Object.hasOwn(SCENE_DATA_LABELS, kind) || !item || typeof item !== 'object') return false;
    const evidence = item as Record<string, unknown>;
    return ['checked', 'listed', 'needs_setup', 'archive', 'partial'].includes(String(evidence.status))
      && (evidence.count === undefined || Number.isSafeInteger(evidence.count) && Number(evidence.count) > 0)
      && (evidence.samplePath === undefined || typeof evidence.samplePath === 'string')
      && (evidence.archiveMember === undefined || typeof evidence.archiveMember === 'string')
      && (evidence.archiveFormat === undefined || ['zip', 'tar.zst'].includes(String(evidence.archiveFormat)))
      && (evidence.encoding === undefined && evidence.requiresConversion === undefined
        || kind === 'splats' && evidence.encoding === 'compressed_ply' && evidence.requiresConversion === true && evidence.status === 'needs_setup');
  });
}

export function sceneDataText(contents?: SceneContents): string {
  return (Object.keys(SCENE_DATA_LABELS) as SceneDataKind[]).filter(kind => contents?.[kind]).map(kind => {
    const status = contents![kind]!.status;
    const suffix = { checked: '', listed: ' · listed', needs_setup: ' · setup', archive: ' · archive', partial: ' · partial' }[status];
    return SCENE_DATA_LABELS[kind] + suffix;
  }).join(', ');
}

export function sceneContentsHtml(contents?: SceneContents): string {
  if (!contents || !Object.keys(contents).length) return '';
  const notes: Record<SceneDataStatus, string> = {
    checked: 'Presence checked. Complete loading and alignment have separate evidence.',
    listed: 'Listed in this scene. Complete loading and alignment have separate evidence.',
    needs_setup: 'Data exists but needs the recorded path setup or format conversion.',
    archive: 'This data is inside a separate archive. Extraction or combining sources is required; the viewer link does not attach it automatically.',
    partial: 'Some registered images are available; the photo audit records the coverage.',
  };
  return '<ul class="dataset-contents" aria-label="Available data">'
    + (Object.keys(SCENE_DATA_LABELS) as SceneDataKind[]).filter(kind => contents[kind]).map(kind => {
      const evidence = contents[kind]!;
      const suffix = { checked: '', listed: ' · listed', needs_setup: ' · setup', archive: ' · archive', partial: ' · partial' }[evidence.status];
      const units: Record<SceneDataKind, string> = { images: 'images', cameras: 'camera definitions', point_cloud: 'points',
        splats: 'splat files', masks: 'masks', meshes: 'mesh files', geometry: 'model files' };
      const count = evidence.count ? `${evidence.count.toLocaleString('en-US')} ${units[kind]}. ` : '';
      return `<li data-asset="${kind}" data-asset-status="${evidence.status}" title="${escape(count + notes[evidence.status])}">${SCENE_DATA_LABELS[kind]}${suffix}</li>`;
    }).join('') + '</ul>';
}

export function sceneThumbnailHtml(entry: { title: string; license: string; licenseCategory?: LicenseCategory; thumbnail?: SceneThumbnail }, compact = false): string {
  const thumbnail = entry.thumbnail;
  if (!thumbnail || !isSceneThumbnail(thumbnail) || thumbnail.datasetLicense !== entry.license) return '';
  return `<figure class="dataset-preview"><img class="dataset-thumbnail" src="${escape(thumbnail.url)}" width="320" height="320" loading="lazy" decoding="async" alt="${escape(`Scene photograph from ${entry.title}`)}">`
    + (compact ? '' : `<figcaption>${sceneThumbnailCreditHtml(thumbnail)}</figcaption>`) + '</figure>';
}

export function sceneThumbnailCreditHtml(thumbnail: SceneThumbnail): string {
  const credit = thumbnail.creditUrl ? `<a href="${escape(thumbnail.creditUrl)}" rel="noreferrer">${escape(thumbnail.attribution)}</a>` : escape(thumbnail.attribution);
  const license = thumbnail.license === 'pd' ? 'Public domain' : thumbnail.license;
  const terms = thumbnail.licenseUrl ? `<a href="${escape(thumbnail.licenseUrl)}" rel="noreferrer">${escape(license)}</a>` : escape(license);
  return `${credit} · ${terms}`;
}

export function scenePlaceholderHtml(entry: { title: string; photoStatus?: PhotoStatus }): string {
  const missing = entry.photoStatus === 'not_included' || entry.photoStatus === 'not_found';
  const label = missing ? 'No photo' : 'No preview';
  return `<figure class="dataset-preview dataset-preview-placeholder" role="img" aria-label="${escape(`${label}: ${entry.title}`)}">`
    + '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="5" width="26" height="22" rx="2"/><circle cx="11" cy="12" r="2"/><path d="m4 24 8-8 6 6 4-4 7 7"/></svg>'
    + `<span>${label}</span></figure>`;
}
