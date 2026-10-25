import assert from 'node:assert/strict';

// Reviewed against the complete archived name inventories at the adapter's pin.
// Other current script settings contradict retained models. A small subset fitting
// those settings does not establish its correspondence (notably hydro_NLP_connection).
export const REVIEWED_MBZUAI_CAPTURES = new Set(['campus_core', 'campus_entrance', 'campus_knowledge_center', 'campus_nlp']);

/** Both explicit publisher settings and a source-wide native-name review are needed. */
export function mbzuaiRecipes(extractor) {
  assert.match(extractor, /"fps=2,scale=iw:ih"/);
  assert.match(extractor, /prev_max_id \+= total_images \+ 1/);
  assert.match(extractor, /"-ss", f"\{skip_start\}"/);
  assert.match(extractor, /"-t", f"\{duration_to_keep\}"/);
  const config = extractor.slice(extractor.indexOf('\nconfig = {'));
  const recipes = new Map();
  for (const [, capture, block] of config.matchAll(/^ {4}"([A-Za-z0-9_]+)":\s*\{([^}]+)\}/gm)) {
    const start = /'skip_start_seconds': (\d+)/.exec(block);
    if (!start || !REVIEWED_MBZUAI_CAPTURES.has(capture)) continue;
    recipes.set(capture, { skipStartSeconds: Number(start[1]), skipEndSeconds: Number(/'skip_end_seconds': (\d+)/.exec(block)?.[1] || 0) });
  }
  assert.ok(recipes.size > 0, 'No explicit publisher extraction settings');
  return recipes;
}

/** FFmpeg fps=2 round=near selects the last source PTS in each output bin.
 * Seek/trim happen before fps; registered numbers also include earlier cameras.
 */
export function extractionFrames(index, formatDuration, recipe, videoDuration = formatDuration) {
  const { skipStartSeconds: start, skipEndSeconds: end } = recipe;
  assert.ok(Number.isFinite(formatDuration) && formatDuration > start + end);
  // Container duration can include a longer audio track; fps stops at video EOF.
  const keptDuration = Math.min(videoDuration - start, formatDuration - start - end);
  const count = Math.floor(keptDuration * 2 + 0.5), selected = new Map();
  for (let frame = 0; frame < index.length; frame++) {
    const time = index[frame] - start;
    if (time < 0 || time >= keptDuration) continue;
    const output = Math.floor(time * 2 + 0.5 + 1e-9);
    if (output < count) selected.set(output, frame);
  }
  assert.equal(selected.size, count, 'Incomplete publisher extraction bins');
  return { count, selected };
}

export function nativeCaptureName(name) {
  const match = /^([^/]+)\/(?:cam)?(0[0-5]|core01)\/(\d{6})_?(a|b|c|d|e|f|core)\.jpg$/.exec(name);
  if (!match) return null;
  const [, capture, camera, number, suffix] = match;
  if (camera !== 'core01' && !name.startsWith(`${capture}/cam`)) return null;
  if (suffix !== (camera === 'core01' ? 'core' : 'abcdef'[Number(camera)])) return null;
  return { capture, camera, number: Number(number) };
}
