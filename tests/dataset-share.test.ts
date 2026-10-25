import { expect, it } from 'vitest';
import { datasetShareId, datasetSharePath } from '../src/shared/dataset-share';

it.each([
  ['000000000000000000000000', 'AAAAAAAAAAAAAAAA'],
  ['ffffffffffffffffffffffff', '________________'],
  ['000102030405060708090a0b', 'AAECAwQFBgcICQoL'],
])('preserves every bit of a scene ID in a stable URL-safe short address', (hex, code) => {
  expect(datasetSharePath(`data-${hex}`)).toBe(`/s/d/${code}`);
  expect(datasetShareId(code)).toBe(`data-${hex}`);
});

it('rejects malformed, non-canonical and unrelated IDs without accepting URL syntax', () => {
  for (const id of ['data-0', 'data-' + 'F'.repeat(24), 'hf-sample-0123456789ab', 'https://example.org', '../private']) expect(datasetSharePath(id)).toBeUndefined();
  for (const code of ['', 'A'.repeat(15), 'A'.repeat(17), '/'.repeat(16), 'A'.repeat(15) + '=', 'A'.repeat(15) + '%']) expect(datasetShareId(code)).toBeUndefined();
});

it('prefers a reserved adjective+noun name and safely falls back for older metadata', () => {
  const id = 'data-' + '0'.repeat(24);
  expect(datasetSharePath(id, 'HappyTree')).toBe('/s/HappyTree');
  expect(datasetSharePath(id, '../private')).toBe('/s/d/AAAAAAAAAAAAAAAA');
  expect(datasetSharePath('unrelated', 'HappyTree')).toBeUndefined();
});
