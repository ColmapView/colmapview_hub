// Offline operator audit. Builds never fetch source data. Only exact, public,
// revision-pinned native layouts already in the catalog can be read here.
import { build } from 'esbuild';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { nativeTextCounts } from './native-text-counts.mjs';

const { values } = parseArgs({ options: {
  'viewer-root': { type: 'string', default: '../colmap-webview' },
  scratch: { type: 'string', default: '.tmp/scene-count-audit' }, source: { type: 'string' },
  'max-file-mib': { type: 'string', default: '1024' },
  apply: { type: 'boolean' }, 'self-test': { type: 'boolean' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('Usage: npm run catalog:counts -- --viewer-root PATH [--source hf:owner/repo] [--scratch PATH] [--max-file-mib 1024] [--apply | --self-test]');
  process.exit(0);
}
const viewer = resolve(values['viewer-root']);
const scratch = resolve(values.scratch);
const sourceFilter = values.source;
const apply = Boolean(values.apply);
const maxBytes = Number(values['max-file-mib']) * 1024 * 1024;
const viewerCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: viewer, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(viewerCommit) || !Number.isSafeInteger(maxBytes) || maxBytes < 8192) throw new Error('Invalid audit configuration');
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: viewer, encoding: 'utf8' });
if (dirty.trim()) throw new Error('Audit requires committed viewer parser dependencies');
await mkdir(resolve(scratch, 'cache'), { recursive: true });
const bundle = resolve(scratch, 'native-parsers.mjs');
await build({
  stdin: { contents: ['cameras', 'images', 'points3d'].map((file, n) =>
    `export {${['parseCamerasText', 'parseImagesText', 'parsePoints3DText'][n]}} from ${JSON.stringify(resolve(viewer, 'src/parsers/' + file + '.ts'))};`).join('\n'),
  resolveDir: viewer, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: bundle,
});
const parsers = await import(pathToFileURL(bundle).href);

// Confirm batching has exactly the same identity semantics as complete parsing,
// including empty observation rows, CRLF, duplicate IDs and PhoMo's extension.
const fixtures = {
  cameras: '# Camera list\n1 PINHOLE 20 10 10 10 5 5\n1 PINHOLE 20 10 10 10 5 5\n2 SIMPLE_RADIAL 20 10 10 5 5 0\n',
  images: '# Image list\r\n1 1 0 0 0 0 0 0 1 one photo.jpg\r\n\r\n# comment\r\n2 1 0 0 0 0 0 0 2 two.jpg\r\n0 0 -1\r\n1 1 0 0 0 0 0 0 2 replacement.jpg',
  points3d: '# Number of points: 9999999\n1 0 1 2 3 4 5 0 1 0\n2 1 2 3 4 5 6 0\n1 2 3 4 5 6 7 0\n9007199254740992 0 0 0 1 2 3 0\n9007199254740993 0 0 0 1 2 3 0\n',
};
const photometric = [
  ['images', '# IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, SX, SY, SZ, CAMERA_ID, NAME, SCALE, BIAS\n# POINTS2D[] as (X, Y, INTENSITY, POINT3D_ID)\n1 1 0 0 0 0 0 0 1 0 0 1 photo.png 1 0\n\n'],
  ['points3d', '# POINT3D_ID, X, Y, Z, NX, NY, NZ, ALBEDO, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)\n1 0 0 0 0 0 1 0.5 100 100 100 0\n'],
  ['points3d', '# no totals\n' + '1 0 1 2 3 4 5 0\n'.repeat(2050) + '4000 1 2 3 4 5 6 0'],
];
for (const [role, text] of [...Object.entries(fixtures), ...photometric]) {
  const parser = parsers[{ cameras: 'parseCamerasText', images: 'parseImagesText', points3d: 'parsePoints3DText' }[role]];
  const expected = parser(text, role === 'images' ? true : undefined);
  const actual = await nativeTextCounts(Readable.from([...Buffer.from(text)].map(byte => Buffer.from([byte]))), role, parsers);
  if (actual.count !== expected.size || [...expected].some(([id, record]) => !actual.ids.has(id)
    || role === 'images' && actual.cameraReferences.get(id) !== record.cameraId)) throw new Error('Native streaming count self-check failed');
}
if (values['self-test']) {
  console.log('Native count reader matches complete viewer parsing for ' + (Object.keys(fixtures).length + photometric.length) + ' fixtures.');
  process.exit(0);
}

const policyPath = 'data/native-layouts.json.gz';
const originalPolicy = await readFile(policyPath);
const policy = JSON.parse(gunzipSync(originalPolicy));
if (sourceFilter !== undefined && !policy.sources.some(source => source.sourceId === sourceFilter)) throw new Error('Unknown source filter');
const catalog = JSON.parse(await readFile('data/catalog.json', 'utf8'));
const parents = new Map(catalog.entries.map(entry => [entry.sourceId, entry]));
const hash = value => createHash('sha256').update(value).digest('hex');
const results = [];
let lastWritten;

async function download(url) {
  const key = hash(url), file = resolve(scratch, 'cache', key + '.txt'), metadata = file + '.json';
  try {
    const record = JSON.parse(await readFile(metadata, 'utf8'));
    if (record.url !== url || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > maxBytes
      || !/^[a-f0-9]{64}$/.test(record.sha256) || !record.checkedAt
      || !['*', 'https://colmapview.opsiclear.com'].includes(record.cors)) throw new Error('Invalid cached source');
    let bytes = 0;
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(file)) { bytes += chunk.length; digest.update(chunk); }
    if (bytes !== record.bytes || digest.digest('hex') !== record.sha256) throw new Error('Cached source checksum changed');
    return { file, record };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { Origin: 'https://colmapview.opsiclear.com', 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(300000) });
    if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
      await response.body?.cancel();
      await new Promise(done => setTimeout(done, (attempt + 1) * 3000));
      continue;
    }
    if (response.status !== 200) { await response.body?.cancel(); throw new Error('Source HTTP ' + response.status); }
    const cors = response.headers.get('access-control-allow-origin');
    if (!['*', 'https://colmapview.opsiclear.com'].includes(cors)) { await response.body.cancel(); throw new Error('Source CORS is missing'); }
    const encoding = response.headers.get('content-encoding');
    const declared = !encoding || encoding === 'identity' ? response.headers.get('content-length') : null;
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) { await response.body.cancel(); throw new Error('Source exceeds complete-file bound'); }
    const temporary = file + '.partial';
    let bytes = 0;
    const digest = createHash('sha256');
    try {
      await pipeline(Readable.from(response.body ?? []), new Transform({ transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > maxBytes) return done(new Error('Source exceeds complete-file bound'));
        digest.update(chunk);
        done(null, chunk);
      } }), createWriteStream(temporary));
      if (declared && Number(declared) !== bytes) throw new Error('Truncated complete source');
      const record = { url, bytes, sha256: digest.digest('hex'), cors, checkedAt: new Date().toISOString() };
      await rename(temporary, file);
      await writeFile(metadata, JSON.stringify(record));
      return { file, record };
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
}

for (const source of policy.sources) {
  if (sourceFilter && source.sourceId !== sourceFilter) continue;
  const parent = parents.get(source.sourceId);
  if (!parent || parent.provider !== 'huggingface' || parent.access !== 'public' || !/^[a-f0-9]{40}$/.test(source.revision)
    || parent.facts.find(fact => fact.label === 'Pinned revision')?.value !== source.revision) throw new Error('Source is not public and pinned');
  for (const model of source.models) {
    const roles = ['cameras', 'images', 'points3d'].filter((role, n) => model[n + 2] === null && model[1][role].toLowerCase().endsWith('.txt'));
    if (!roles.length) continue;
    const result = { sourceId: source.sourceId, revision: source.revision, path: model[0], files: {}, errors: [] };
    for (const role of roles) {
      const path = model[1][role];
      if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || ['.', '..'].includes(part))) throw new Error('Invalid pinned model path');
      const url = 'https://huggingface.co/datasets/' + source.sourceId.slice(3) + '/resolve/' + source.revision + '/' + path.split('/').map(encodeURIComponent).join('/');
      try {
        const { file, record } = await download(url);
        const parsed = await nativeTextCounts(createReadStream(file), role, parsers);
        if (role !== 'points3d' && !parsed.count) throw new Error('No parsed camera/pose records');
        result.files[role] = { path, count: parsed.count, bytes: record.bytes, sha256: record.sha256, cors: record.cors };
        console.log(JSON.stringify({ sourceId: source.sourceId, path, count: parsed.count, bytes: record.bytes }));
      } catch (error) {
        result.errors.push({ role, error: String(error) });
        console.log(JSON.stringify({ sourceId: source.sourceId, path, error: String(error) }));
      }
    }
    result.checkedAt = new Date().toISOString();
    if (Object.keys(result.files).length) {
      const audit = model[7].countAudit;
      if (audit && audit.viewerCommit !== viewerCommit) throw new Error('Do not mix parser revisions in an existing count audit');
      model[7].countAudit = { method: 'viewer_native_text_parse', checkedAt: result.checkedAt, viewerCommit, files: { ...audit?.files, ...result.files } };
      for (const [role, file] of Object.entries(result.files)) model[['cameras', 'images', 'points3d'].indexOf(role) + 2] = file.count;
    }
    results.push(result);
    await writeFile(resolve(scratch, 'results.json'), JSON.stringify({ viewerCommit, results }, null, 2));
    if (apply) {
      // Fail concurrent edits rather than replacing another operator's evidence.
      const current = await readFile(policyPath);
      if (hash(current) !== hash(originalPolicy) && hash(current) !== lastWritten) throw new Error('Native policy changed during audit');
      const bytes = gzipSync(JSON.stringify(policy), { mtime: 0 });
      const temporaryPolicy = resolve(scratch, 'native-layouts.json.gz.tmp');
      await writeFile(temporaryPolicy, bytes);
      await rename(temporaryPolicy, policyPath);
      lastWritten = hash(bytes);
    }
  }
}
const failures = results.reduce((sum, row) => sum + row.errors.length, 0);
console.log(JSON.stringify({ auditedModels: results.length, countedFiles: results.reduce((sum, row) => sum + Object.keys(row.files).length, 0), failures, applied: apply }));
if (failures) process.exitCode = 1;
