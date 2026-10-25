import { SHARE_PATH } from './model';

export const DATASET_SHARE_PATH = `${SHARE_PATH}/d`;

/** Encode the complete existing scene ID: stable, reversible and collision-free. */
export function datasetSharePath(id: string): string | undefined {
  if (!/^data-[a-f0-9]{24}$/.test(id)) return;
  const bytes = id.slice(5).match(/../g)!.map(byte => String.fromCharCode(parseInt(byte, 16))).join('');
  return `${DATASET_SHARE_PATH}/${btoa(bytes).replaceAll('+', '-').replaceAll('/', '_')}`;
}

export function datasetShareId(code: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{16}$/.test(code)) return;
  const bytes = atob(code.replaceAll('-', '+').replaceAll('_', '/'));
  return 'data-' + [...bytes].map(byte => byte.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}
