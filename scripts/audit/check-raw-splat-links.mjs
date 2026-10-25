/** Operator-only bounded probes for headerless SPLAT and zipped SOG candidates. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const dir = '.tmp/splat-link-audit-20261025';
const plan = JSON.parse(await readFile(`${dir}/plan.json`, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [];
async function range(url, value) {
  const response = await fetch(url, { headers: { Range: value }, signal: AbortSignal.timeout(30000) });
  if (response.status !== 206 || response.headers.get('access-control-allow-origin') !== '*') throw Error('Public range/CORS check failed');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > 131072) throw Error('Range exceeded probe bound');
      chunks.push(Buffer.from(part.value));
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  return { bytes, total: Number(response.headers.get('content-range')?.split('/').at(-1)) };
}
for (const asset of plan.assets.filter(a => ['splat', 'sog'].includes(a.kind))) {
  const source = plan.sources[asset.source];
  const url = `https://huggingface.co/datasets/${source.sourceId.slice(3)}/resolve/${source.revision}/${asset.path.split('/').map(encodeURIComponent).join('/')}`;
  const row = { sourceId: source.sourceId, revision: source.revision, path: asset.path, url, format: asset.kind, checkedAt: new Date().toISOString() };
  try {
    const probe = await range(url, 'bytes=0-65535');
    Object.assign(row, { bytes: probe.total, headerSha256: sha(probe.bytes), headerBytes: probe.bytes.length, allowOrigin: '*' });
    if (asset.kind === 'splat') {
      if (!probe.total || probe.total % 32) throw Error('Invalid 32-byte Gaussian record length');
      for (let offset = 0; offset + 32 <= probe.bytes.length; offset += 32) {
        for (let field = 0; field < 6; field++) {
          const value = probe.bytes.readFloatLE(offset + field * 4);
          if (!Number.isFinite(value) || field >= 3 && value < 0) throw Error('Invalid sampled Gaussian position/scale');
        }
      }
      row.gaussians = probe.total / 32;
      row.method = 'raw_splat_length_and_sampled_records';
    } else {
      const tail = await range(url, 'bytes=-65536');
      const eocd = tail.bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (eocd < 0) throw Error('SOG ZIP directory missing');
      const centralOffset = tail.bytes.readUInt32LE(eocd + 16);
      const directory = centralOffset - (probe.total - tail.bytes.length);
      let cursor = directory, meta;
      while (cursor >= 0 && cursor + 46 <= tail.bytes.length && tail.bytes.readUInt32LE(cursor) === 0x02014b50) {
        const nameLength = tail.bytes.readUInt16LE(cursor + 28);
        const name = tail.bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
        if (name === 'meta.json') meta = { offset: tail.bytes.readUInt32LE(cursor + 42), size: tail.bytes.readUInt32LE(cursor + 20), method: tail.bytes.readUInt16LE(cursor + 10) };
        cursor += 46 + nameLength + tail.bytes.readUInt16LE(cursor + 30) + tail.bytes.readUInt16LE(cursor + 32);
      }
      if (!meta || meta.size > 60000) throw Error('Bounded SOG metadata missing');
      const local = await range(url, `bytes=${meta.offset}-${meta.offset + meta.size + 1023}`);
      if (local.bytes.readUInt32LE(0) !== 0x04034b50) throw Error('Invalid SOG local header');
      const start = 30 + local.bytes.readUInt16LE(26) + local.bytes.readUInt16LE(28);
      const compressed = local.bytes.subarray(start, start + meta.size);
      const body = meta.method === 0 ? compressed : meta.method === 8 ? inflateRawSync(compressed, { maxOutputLength: 65536 }) : null;
      row.metadata = JSON.parse(body?.toString('utf8') ?? 'null');
      row.metadataSha256 = sha(body);
      row.gaussians = row.metadata?.count;
      if (!Number.isSafeInteger(row.gaussians) || row.gaussians < 1 || !row.metadata?.means || !row.metadata?.scales || !row.metadata?.quats) throw Error('Unsupported SOG metadata');
      row.method = 'sog_zip_metadata';
    }
    row.status = 'header_checked';
    row.role = 'gaussian-splat';
  } catch (error) { row.status = 'failed'; row.error = error.message; }
  rows.push(row);
}
await writeFile(`${dir}/raw-headers.json`, JSON.stringify(rows, null, 2) + '\n');
console.log(JSON.stringify(rows.map(({ sourceId, path, status, error, gaussians }) => ({ sourceId, path, status, error, gaussians }))));
