import { individualDatasetOptions } from '../shared/individual-catalog';
import type { IndividualIndex } from '../shared/individual-catalog';
import { PHOTO_LABELS, isPhotoStatus } from '../shared/scene-photos';
import { SCENE_DATA_LABELS } from '../shared/scene-contents';
import { hubApiBase } from './hosting';

/** Refresh the static shell's choices without copying the catalog into GitHub Pages. */
export async function refreshCatalogFilters(form: HTMLFormElement): Promise<string> {
  const response = await fetch(`${hubApiBase()}/datasets/api/index`, { credentials: 'omit' });
  if (!response.ok) throw new Error('Catalog index unavailable');
  const index = await response.json() as IndividualIndex;
  if (index.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(index.generation)
    || !Number.isSafeInteger(index.total) || index.total < 1 || !Array.isArray(index.sources) || index.sources.length > 10000
    || !index.sources.every(source => typeof source.id === 'string' && typeof source.label === 'string'
      && typeof source.title === 'string' && Number.isSafeInteger(source.count) && source.count >= 0)) throw new Error('Invalid catalog index');
  const choices: Record<string, { value: string; label: string }[]> = {
    dataset: individualDatasetOptions(index.sources, new URLSearchParams(location.search).get('dataset') || ''),
    license: [...new Set(index.sources.map(source => source.license))].sort().map(value => ({ value, label: value })),
    kind: Object.keys(index.kinds).sort().map(value => ({ value, label: value })),
    status: Object.keys(index.levels).sort().map(value => ({ value, label: value })),
    photos: [{ value: 'available', label: 'Images on current paths' }, ...Object.keys(index.photos || {}).sort()
      .filter(isPhotoStatus).map(value => ({ value, label: PHOTO_LABELS[value] }))],
    data: Object.entries(SCENE_DATA_LABELS).filter(([key]) => index.contents?.[key as keyof typeof SCENE_DATA_LABELS])
      .map(([value, label]) => ({ value, label })),
  };
  for (const [name, values] of Object.entries(choices)) {
    const select = form.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
    if (!select || !select.options[0]) continue;
    const selected = select.value;
    const options = values.map(({ value, label }) => new Option(label, value));
    select.replaceChildren(select.options[0].cloneNode(true), ...options);
    select.value = selected;
  }
  const totals = document.querySelector('.catalog-totals');
  if (totals) totals.textContent = `${index.total.toLocaleString('en-US')} scene entries · ${index.sources.filter(source => source.count).length} sources`;
  return index.generation;
}
