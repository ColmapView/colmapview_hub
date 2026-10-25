/** Compare bounded exact XYZ fingerprints to associate alternate Gaussian exports. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const dir = '.tmp/splat-link-audit-20261025';
const prepared = JSON.parse(await readFile(`${dir}/prepared.json`, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function prefix(url) {
  const response = await fetch(url, { headers: { Range: 'bytes=0-1048575' }, signal: AbortSignal.timeout(30000) });
  if (response.status !== 206 || response.headers.get('access-control-allow-origin') !== '*') throw Error('Public range/CORS check failed');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > 1048576) throw Error('Position probe exceeds one MiB');
      chunks.push(Buffer.from(part.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
const receipts = [];
for (const route of prepared.routes.filter(row => row.sourceId === 'hf:Yiwen-ntu/GaussianEditor_Result')) {
  const original = route.assets.find(asset => asset.format === 'ply');
  const body = await prefix(original.url), marker = Buffer.from('end_header\n');
  const headerEnd = body.indexOf(marker);
  if (headerEnd < 0) throw Error('Complete PLY header missing');
  const offset = headerEnd + marker.length, header = body.subarray(0, offset).toString('ascii');
  const properties = [...header.matchAll(/^property (\S+) (\S+)$/gm)];
  if (!header.includes('format binary_little_endian 1.0') || properties.some(property => property[1] !== 'float')
    || properties.slice(0, 3).map(property => property[2]).join(',') !== 'x,y,z') throw Error('Unsupported reference PLY layout');
  const stride = properties.length * 4, positions = new Set();
  for (let start = offset; start + stride <= body.length; start += stride) positions.add(body.subarray(start, start + 12).toString('hex'));
  const leaf = route.path.split('/').at(-3);
  for (const path of leaf === 'bear' ? ['bear_origin.splat', 'bear.splat'] : ['face.splat', 'face_trump.splat']) {
    const url = original.url.split('/InstructNeRF2NeRF_PLY_Files/')[0] + '/' + path;
    const raw = await prefix(url), matched = new Set();
    for (let start = 0; start + 32 <= raw.length; start += 32) {
      const xyz = raw.subarray(start, start + 12).toString('hex');
      if (positions.has(xyz)) matched.add(xyz);
    }
    receipts.push({ id: route.id, path, url, sourcePath: original.path, sourceUrl: original.url,
      method: 'sampled_identical_gaussian_positions', matched: matched.size, referenceSample: positions.size,
      alternateSample: Math.floor(raw.length / 32), referenceStride: stride,
      referencePrefixSha256: sha(body), alternatePrefixSha256: sha(raw),
      referencePrefixBytes: body.length, alternatePrefixBytes: raw.length, checkedAt: new Date().toISOString(),
      scope: 'Distinct exact float32 XYZ matches establish the source coordinate frame; edited geometry and all remaining records are separate checks.' });
  }
}
await writeFile(`${dir}/raw-position-associations.json`, JSON.stringify(receipts, null, 2) + '\n');
console.log(JSON.stringify(receipts.map(({ path, matched }) => ({ path, matched }))));
