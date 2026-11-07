import { individualDatasetOptions } from '../shared/individual-catalog';
import type { IndividualIndex } from '../shared/individual-catalog';
import { PHOTO_LABELS, isPhotoStatus } from '../shared/scene-photos';
import { SCENE_DATA_LABELS } from '../shared/scene-contents';
import { hubApiBase } from './hosting';

type CatalogField = HTMLInputElement | HTMLSelectElement;

/** Keep an unavailable collection scoped without inventing a listed option. */
export const catalogFieldValue = (field: CatalogField): string => field.value || field.dataset.unavailableValue || '';

export function setCatalogFieldValue(field: CatalogField, value: string, label = value): boolean {
  delete field.dataset.unavailableValue;
  const missing = field instanceof HTMLSelectElement && Boolean(value) && ![...field.options].some(option => option.value === value);
  if (field instanceof HTMLSelectElement && field.name === 'dataset') {
    field.options[0].textContent = missing ? 'Selected collection' : 'All collections';
    if (missing) {
      field.value = '';
      field.dataset.unavailableValue = value;
      return true;
    }
  } else if (missing && field instanceof HTMLSelectElement) field.add(new Option(label, value));
  field.value = value;
  return missing;
}

/** Refresh the static shell's choices without copying the catalog into GitHub Pages. */
export async function refreshCatalogFilters(form: HTMLFormElement): Promise<string> {
  const response = await fetch(`${hubApiBase()}/datasets/api/index`, { credentials: 'omit', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Catalog index unavailable');
  const index = await response.json() as IndividualIndex;
  if (index.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(index.generation)
    || !Number.isSafeInteger(index.total) || index.total < 1 || !Array.isArray(index.sources) || index.sources.length > 10000
    || !index.sources.every(source => typeof source.id === 'string' && typeof source.label === 'string'
      && typeof source.title === 'string' && Number.isSafeInteger(source.count) && source.count >= 0)) throw new Error('Invalid catalog index');
  const choices: Record<string, { value: string; label: string }[]> = {
    dataset: individualDatasetOptions(index.sources, catalogFieldValue(form.querySelector<HTMLSelectElement>('select[name="dataset"]')!)),
    license: [...new Set(index.sources.map(source => source.license))].sort().map(value => ({ value, label: value })),
    kind: Object.keys(index.kinds).sort().map(value => ({ value, label: value })),
    status: Object.keys(index.levels).filter(value => value !== 'Access required' || new URLSearchParams(location.search).get('status') === value).sort().map(value => ({ value, label: value })),
    photos: [{ value: 'available', label: 'Images on current paths' }, ...Object.keys(index.photos || {}).sort()
      .filter(isPhotoStatus).map(value => ({ value, label: PHOTO_LABELS[value] }))],
    data: Object.entries(SCENE_DATA_LABELS).filter(([key]) => index.contents?.[key as keyof typeof SCENE_DATA_LABELS])
      .map(([value, label]) => ({ value, label })),
  };
  for (const [name, values] of Object.entries(choices)) {
    const select = form.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
    if (!select || !select.options[0]) continue;
    const selected = catalogFieldValue(select);
    const label = select.selectedOptions[0]?.textContent || selected;
    const options = values.map(({ value, label }) => new Option(label, value));
    select.replaceChildren(select.options[0].cloneNode(true), ...options);
    setCatalogFieldValue(select, selected, label);
  }
  const totals = document.querySelector('.catalog-totals');
  if (totals) totals.textContent = `${index.total.toLocaleString('en-US')} scene entries · ${index.sources.filter(source => source.count).length} sources`;
  return index.generation;
}
