import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reserveCatalogName, validateNames } from '../scripts/catalog/share-names.mjs';

const dataset = 'data-' + '0'.repeat(24);
test('reserving a catalog name never overwrites an upload collision', async () => {
  const stored = new Map([['links/HappyTree.json', 'existing upload']]);
  const reserve = async (key, value) => {
    if (stored.has(key)) return null;
    stored.set(key, value); return true;
  };
  const candidates = ['HappyTree', 'CalmStone'];
  assert.equal(await reserveCatalogName(reserve, dataset, async () => candidates.shift()), 'CalmStone');
  assert.equal(stored.get('links/HappyTree.json'), 'existing upload');
  const alias = JSON.parse(stored.get('links/CalmStone.json'));
  assert.equal(alias.kind, 'catalog');
  assert.equal(alias.datasetId, dataset);
  assert.equal(alias.ownerHash, undefined);
  assert.equal(alias.viewerUrl, undefined);
});

test('concurrent reservations cannot assign one name to two datasets', async () => {
  const stored = new Map();
  const reserve = async (key, value) => { if (stored.has(key)) return false; stored.set(key, value); return true; };
  const first = ['HappyTree', 'CalmStone'], second = ['HappyTree', 'BrightRiver'];
  const result = await Promise.all([
    reserveCatalogName(reserve, dataset, async () => first.shift()),
    reserveCatalogName(reserve, 'data-' + '1'.repeat(24), async () => second.shift()),
  ]);
  assert.equal(new Set(result).size, 2);
  assert.equal(stored.size, 2);
});

test('invalid IDs and candidates cannot write to other namespaces', async () => {
  const reserve = () => { throw new Error('Unexpected write'); };
  await assert.rejects(reserveCatalogName(reserve, '../private', async () => 'HappyTree'), /Invalid public dataset/);
  await assert.rejects(reserveCatalogName(reserve, dataset, async () => '../private'), /Invalid catalog name/);
});

test('an occupied namespace stops after a bounded number of attempts', async () => {
  let calls = 0;
  await assert.rejects(reserveCatalogName(async () => { calls++; return false; }, dataset, async () => 'HappyTree'), /free catalog name/);
  assert.equal(calls, 64);
});

test('registries reject reused word pairs, invalid scene IDs and URL syntax', () => {
  assert.deepEqual(validateNames({ schemaVersion: 1, names: { [dataset]: 'HappyTree' } }), { [dataset]: 'HappyTree' });
  for (const names of [{ [dataset]: 'HappyTree', ['data-' + '1'.repeat(24)]: 'HappyTree' },
    { bad: 'HappyTree' }, { [dataset]: 'https://untrusted.example' }]) {
    assert.throws(() => validateNames({ schemaVersion: 1, names }), /Invalid|duplicated/);
  }
});
