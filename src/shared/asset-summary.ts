import type { AssetSummary } from './model';

/** Nonzero counts only, for example "83 images · 83,749 points · 82 masks · 1 splat". */
export function assetLine(assets?: AssetSummary): string {
  if (!assets) return '';
  const count = (value: number, noun: string) => value ? `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}` : '';
  return [count(assets.images, 'image'), count(assets.colmap.points, 'point'), count(assets.masks, 'mask'), count(assets.splats, 'splat')]
    .filter(Boolean).join(' · ');
}
