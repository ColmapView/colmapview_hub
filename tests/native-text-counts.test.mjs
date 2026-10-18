import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Readable } from 'node:stream';
import { nativeTextCounts } from '../scripts/audit/native-text-counts.mjs';

// Small parser contract doubles let the Hub's tests run without checking out
// the viewer. The operator command also compares against its actual parsers.
function records(text, role, skipPoints) {
  if (text.slice(0, 8192).includes('# UNSUPPORTED')) throw new Error('Unsupported schema');
  const result = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].trim().match(/^(\d+) (?:camera|pose|point)(?: (.*))?$/);
    if (!match) continue;
    result.set(Number(match[1]), { cameraId: Number(match[2]) || 1 });
    if (role === 'images') {
      assert.equal(skipPoints, true);
      i++;
    }
  }
  return result;
}
const parsers = {
  parseCamerasText: text => records(text, 'cameras'),
  parseImagesText: (text, skip) => records(text, 'images', skip),
  parsePoints3DText: text => records(text, 'points3d'),
};
const stream = text => Readable.from([...Buffer.from(text)].map(byte => Buffer.from([byte])));

test('camera/point totals merge duplicate IDs across batches, not lines or the largest ID', async () => {
  for (const role of ['cameras', 'points3d']) {
    const word = role === 'cameras' ? 'camera' : 'point';
    const text = '# model\r\n' + `1 ${word}\n`.repeat(2050) + `2000 ${word}`;
    const result = await nativeTextCounts(stream(text), role, parsers);
    assert.equal(result.count, 2);
    assert.deepEqual([...result.ids], [1, 2000]);
  }
});

test('poses consume exactly one observation line, including blanks and comments', async () => {
  const text = '# model\r\n1 pose 1\r\n\r\n# header comment\r\n2 pose 2\r\n# observation comment\r\n3 pose 1\r\n99 pose 99\r\n1 pose 2';
  const result = await nativeTextCounts(stream(text), 'images', parsers);
  assert.equal(result.count, 3);
  assert.equal(result.ids.has(99), false);
  assert.deepEqual([...result.cameraReferences], [[1, 2], [2, 2], [3, 1]]);
});

test('a skipped header does not consume the following valid pose', async () => {
  const result = await nativeTextCounts(stream('malformed\n8 pose 2\n\n'), 'images', parsers);
  assert.equal(result.count, 1);
});

test('the original schema window is reused, not comments appearing in a later batch', async () => {
  await assert.rejects(nativeTextCounts(stream('# UNSUPPORTED\n1 point'), 'points3d', parsers), /Unsupported schema/);
  const text = '# model\n' + '1 point\n'.repeat(2050) + '# UNSUPPORTED\n200 point\n';
  const result = await nativeTextCounts(stream(text), 'points3d', parsers);
  assert.equal(result.count, 2);
});

test('UTF-8 split across byte chunks, an empty file and missing final newline are handled', async () => {
  const result = await nativeTextCounts(stream('# café 📷\r\n7 camera'), 'cameras', parsers);
  assert.equal(result.count, 1);
  assert.equal((await nativeTextCounts(stream(''), 'points3d', parsers)).count, 0);
  await assert.rejects(nativeTextCounts(Readable.from([Buffer.from([255])]), 'points3d', parsers), /encoded data/);
});
