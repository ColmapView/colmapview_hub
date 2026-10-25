import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { streamPoseHeaders, pinnedFileChunks, pinnedModelFiles } from '../scripts/audit/native-pose-stream.mjs';

function model(observations = 2) {
  const count = Buffer.alloc(8); count.writeBigUInt64LE(1n);
  const fixed = Buffer.alloc(64); fixed.writeUInt32LE(7); fixed.writeDoubleLE(1, 4); fixed.writeUInt32LE(2, 60);
  const tracks = Buffer.alloc(8); tracks.writeBigUInt64LE(BigInt(observations));
  return Buffer.concat([count, fixed, Buffer.from('capture/café.jpg\0'), tracks, Buffer.alloc(observations * 24, 255)]);
}

test('streaming native headers handles every byte boundary and hashes discarded observations', async () => {
  const original = model();
  const result = await streamPoseHeaders([...original].map(byte => Buffer.from([byte])));
  assert.equal(result.total, 1); assert.equal(result.inspected, 1); assert.equal(result.sourceBytes, original.length);
  assert.equal(result.sha256, createHash('sha256').update(original).digest('hex'));
  assert.deepEqual(result.bytes, model(0));
});

test('native caches retain full Git/LFS receipts and refetch corrupted compact headers', async t => {
  const cache = await mkdtemp(join(tmpdir(), 'colmap-native-'));
  t.after(() => rm(cache, { recursive: true, force: true }));
  const bodies = { cameras: Buffer.alloc(8, 3), images: model(), points3d: Buffer.alloc(12, 4) };
  const files = Object.fromEntries(Object.keys(bodies).map(role => [role, role + '.bin']));
  const sha = body => createHash('sha256').update(body).digest('hex');
  const tree = Object.entries(bodies).map(([role, body]) => ({ type: 'file', path: files[role], size: body.length,
    oid: createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex'),
    ...(role === 'points3d' ? { lfs: { oid: sha(body) } } : {}) }));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => { calls++; return new Response(bodies[new URL(url).pathname.slice(1, -4)]); });
  const load = () => pinnedModelFiles(files, tree, path => 'https://data.test/' + path, cache);
  const first = await load();
  assert.deepEqual(first.bodies.images, model(0)); assert.equal(first.receipts.images.sha256, sha(bodies.images));
  assert.equal(first.bodies.points3d, undefined); assert.equal(calls, 3);
  assert.deepEqual(await load(), first); assert.equal(calls, 3);
  const cached = join(cache, tree[1].oid + '.bin');
  const altered = await readFile(cached); altered[8] ^= 1; await writeFile(cached, altered);
  assert.deepEqual(await load(), first); assert.equal(calls, 4);
});

test('interrupted native responses resume without hashing repeated bytes', async t => {
  const original = model(), offset = 90, requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(options.headers?.Range);
    if (requests.length === 1) return { status: 200, body: (async function* () {
      yield original.subarray(0, offset); throw new Error('Interrupted transport');
    })() };
    return new Response(original.subarray(offset), { status: 206,
      headers: { 'Content-Range': `bytes ${offset}-${original.length - 1}/${original.length}` } });
  });
  const result = await streamPoseHeaders(pinnedFileChunks('https://data.test/model.bin', original.length));
  assert.deepEqual(requests, [undefined, `bytes=${offset}-${original.length - 1}`]);
  assert.equal(result.sha256, createHash('sha256').update(original).digest('hex'));
});

test('resumed responses cannot silently restart or return another range', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1
    ? { status: 200, body: (async function* () { yield Buffer.from([1]); throw new Error('Interrupted'); })() }
    : new Response(new Uint8Array([1, 2])));
  await assert.rejects(async () => { for await (const _chunk of pinnedFileChunks('https://data.test/model.bin', 2)) void _chunk; }, /response status/);
});

test('streaming native headers rejects incomplete observations, records, trailing bytes and unsafe counts', async () => {
  const original = model();
  for (const length of [0, 7, 20, original.length - 1]) {
    await assert.rejects(streamPoseHeaders([original.subarray(0, length)]), /Truncated/);
  }
  await assert.rejects(streamPoseHeaders([original, Buffer.from([0])]), /Trailing/);
  const unsafe = Buffer.alloc(8); unsafe.writeBigUInt64LE(2n ** 63n);
  await assert.rejects(streamPoseHeaders([unsafe]), /pose count/);
  const overflow = model(0); overflow.writeBigUInt64LE(2n ** 63n, overflow.length - 8);
  await assert.rejects(streamPoseHeaders([overflow]), /observation offset/);
});
