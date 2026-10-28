import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Read only the generated public projection, never user records or source datasets. */
export async function preparedCatalog() {
  const root = 'public/hub/datasets/individual';
  const index = JSON.parse(await readFile(`${root}/index.json`, 'utf8'));
  assert.match(index.generation, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(index.total) && index.total > 0);
  assert.equal(index.summaries?.format, 'jsonl');
  assert.ok(Number.isSafeInteger(index.summaries.packSize) && index.summaries.packSize >= 1 && index.summaries.packSize <= 24);
  const rows = [], seen = new Set();
  for (let start = 0; start < index.total; start += index.summaries.packSize) {
    const [header, ...lines] = (await readFile(`${root}/summaries/${start / index.summaries.packSize}.jsonl`, 'utf8')).split('\n');
    const pack = JSON.parse(header);
    assert.equal(pack.schemaVersion, 1); assert.equal(pack.generation, index.generation);
    assert.equal(pack.count, Math.min(index.summaries.packSize, index.total - start)); assert.equal(pack.count, lines.length);
    for (const json of lines) {
      const { id } = JSON.parse(json);
      assert.match(id, /^data-[a-f0-9]{24}$/); assert.ok(!seen.has(id)); seen.add(id);
      rows.push({ id, json });
    }
  }
  assert.equal(rows.length, index.total);
  return { index, rows };
}
