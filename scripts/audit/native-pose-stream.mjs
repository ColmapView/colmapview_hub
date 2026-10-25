import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Read every binary pose/name and hash the complete file, discarding observations.
 * The returned zero-observation model is for name/calibration evidence only.
 */
export async function streamPoseHeaders(chunks) {
  const digest = createHash('sha256'), records = [];
  let state = 'count', pending = Buffer.alloc(0), fixed, name = [], nameBytes = 0;
  let total = 0, skip = 0, sourceBytes = 0;
  for await (const value of chunks) {
    const chunk = Buffer.from(value); digest.update(chunk); sourceBytes += chunk.length;
    let cursor = 0;
    while (cursor < chunk.length) {
      if (state === 'done') throw new Error('Trailing native pose bytes');
      if (state === 'skip') {
        const length = Math.min(skip, chunk.length - cursor); cursor += length; skip -= length;
        if (!skip) state = records.length === total ? 'done' : 'fixed';
        continue;
      }
      if (state === 'name') {
        const end = chunk.indexOf(0, cursor), stop = end < 0 ? chunk.length : end + 1;
        const part = chunk.subarray(cursor, stop); nameBytes += part.length;
        if (nameBytes > 4096) throw new Error('Native pose name exceeds budget');
        name.push(Buffer.from(part)); cursor = stop;
        if (end >= 0) state = 'observations';
        continue;
      }
      const required = state === 'fixed' ? 64 : 8;
      const length = Math.min(required - pending.length, chunk.length - cursor);
      pending = Buffer.concat([pending, chunk.subarray(cursor, cursor + length)]); cursor += length;
      if (pending.length < required) continue;
      if (state === 'count') {
        total = Number(pending.readBigUInt64LE());
        if (!Number.isSafeInteger(total) || total < 1 || total > 1000000) throw new Error('Invalid native pose count');
        state = 'fixed';
      } else if (state === 'fixed') {
        fixed = pending; name = []; nameBytes = 0; state = 'name';
      } else {
        const observations = Number(pending.readBigUInt64LE()); skip = observations * 24;
        if (!Number.isSafeInteger(skip)) throw new Error('Invalid native observation offset');
        records.push(Buffer.concat([fixed, ...name, Buffer.alloc(8)]));
        state = skip ? 'skip' : records.length === total ? 'done' : 'fixed';
      }
      pending = Buffer.alloc(0);
    }
  }
  if (state !== 'done') throw new Error('Truncated native pose file');
  const count = Buffer.alloc(8); count.writeBigUInt64LE(BigInt(total));
  return { bytes: Buffer.concat([count, ...records]), total, inspected: records.length, sourceBytes, sha256: digest.digest('hex') };
}

/** Resume an interrupted public response at the exact consumed byte offset. */
export async function* pinnedFileChunks(url, size) {
  let offset = 0, lastError;
  for (let attempt = 0; attempt < 4 && offset < size; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20 * 60 * 1000),
        ...(offset ? { headers: { Range: `bytes=${offset}-${size - 1}` } } : {}) });
      assert.equal(response.status, offset ? 206 : 200, 'Pinned file response status');
      if (offset) assert.equal(response.headers.get('content-range'), `bytes ${offset}-${size - 1}/${size}`, 'Resumed file range');
      for await (const chunk of response.body) {
        offset += chunk.length; assert.ok(offset <= size, 'Native response exceeds its pinned size');
        yield chunk;
      }
      if (offset === size) return;
      lastError = new Error('Truncated pinned file response');
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Missing pinned file response');
}

/** Complete native-file hashes with a small, hash-checked pose/calibration cache.
 * Large observation/point payloads are streamed once and never kept on disk.
 */
export async function pinnedModelFiles(files, tree, sourceUrl, cache) {
  await mkdir(cache, { recursive: true });
  const bodies = {}, receipts = {};
  const hash = body => createHash('sha256').update(body).digest('hex');
  for (const [role, path] of Object.entries(files)) {
    assert.ok(['cameras', 'images', 'points3d'].includes(role), 'Unreviewed native model role');
    const entry = tree.find(row => row.type === 'file' && row.path === path);
    assert.ok(entry && Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 1024 ** 3);
    const identity = entry.lfs?.oid || entry.oid;
    assert.match(identity, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
    const key = resolve(cache, identity);
    let receipt, body;
    try {
      receipt = JSON.parse(await readFile(key + '.json'));
      assert.equal(receipt.bytes, entry.size); assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
      if (entry.lfs) assert.equal(receipt.sha256, entry.lfs.oid);
      else if (role !== 'cameras') assert.equal(receipt.oid, entry.oid);
      if (role !== 'points3d') {
        body = await readFile(key + '.bin');
        assert.equal(hash(body), receipt.headerSha256);
        if (!entry.lfs && role === 'cameras') assert.equal(createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex'), entry.oid);
      }
    } catch {
      const gitDigest = entry.lfs ? null : createHash('sha1').update(`blob ${entry.size}\0`);
      const chunks = (async function* () {
        for await (const chunk of pinnedFileChunks(sourceUrl(path), entry.size)) {
          gitDigest?.update(chunk); yield chunk;
        }
      })();
      let actual, size = 0;
      if (role === 'images') {
        const result = await streamPoseHeaders(chunks);
        body = result.bytes; actual = result.sha256; size = result.sourceBytes;
      } else {
        const digest = createHash('sha256'), cameraChunks = [];
        for await (const chunk of chunks) {
          size += chunk.length; assert.ok(size <= entry.size, 'Native response exceeds its pinned size');
          digest.update(chunk);
          if (role === 'cameras') cameraChunks.push(chunk);
        }
        actual = digest.digest('hex');
        if (role === 'cameras') body = Buffer.concat(cameraChunks);
      }
      assert.equal(size, entry.size);
      if (entry.lfs) assert.equal(actual, entry.lfs.oid);
      else assert.equal(gitDigest.digest('hex'), entry.oid);
      receipt = { bytes: size, sha256: actual, oid: entry.oid, ...(body ? { headerSha256: hash(body) } : {}) };
      if (body) await writeFile(key + '.bin', body);
      await writeFile(key + '.json', JSON.stringify(receipt) + '\n');
    }
    receipts[role] = { sourcePath: path, bytes: receipt.bytes, sha256: receipt.sha256 };
    if (body) bodies[role] = body;
  }
  return { bodies, receipts };
}
