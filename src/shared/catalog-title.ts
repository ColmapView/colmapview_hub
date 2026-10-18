import type { CatalogSummary } from './catalog';

// Keep scene names with their reconstruction/split variants, without displaying
// the repository's enclosing storage paths. Canonical titles stay in metadata.
const variant = /^(?:\d+|\d+_txt|instance_\d+|t\d+|loc\d+|eps.*|ps_eps.*|clean|init|final|refined_aligned|readout|ref|reference|test|train|single|joint|anchored|solve|undistorted|distorted|distorded_images|dense|output|cam|camera|cameras|poses|model|models|bin|text|visual_reloc|colmap(?:_workspace|_prj)?|sparse(?:[_.].*)?|dslr_calibration_.*|rig_calibration_.*|nerfstudio|pycolmap_.*|reconstruction_.*)$/i;
const container = /^(?:colmap(?:_workspace|_prj)?|sparse|models|poses|camera|cameras)$/i;
const wrapper = /^(?:data|datasets?|inputs?|scenes?|reconstructions?|benchmark|preprocessing|native_ply|capture|ground_truths|real_scene_data|training_data|viewpoints)$/i;

export function catalogCardTitle(entry: CatalogSummary): string {
  const parts = entry.title.split('/').filter(Boolean);
  if (!parts.length) return entry.dataset?.label || entry.title;
  let start = parts.length - 1;
  if (entry.dataset) {
    while (start > 0 && variant.test(parts[start])) start--;
  }
  const names = [...parts.slice(start).filter(part => !container.test(part)),
    ...parts.slice(0, start).filter(part => !container.test(part) && !wrapper.test(part))];
  return (names.length ? names : [entry.dataset?.label || parts.at(-1)!]).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  }).join(' · ');
}
