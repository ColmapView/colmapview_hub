/** Bounded, resumable public header audit. No whole Gaussian models are downloaded. */
import { build } from 'esbuild';
import { mkdir, readFile, appendFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { plan: { type: 'string', default: '.tmp/splat-link-audit-20261025/plan.json' },
  output: { type: 'string', default: '.tmp/splat-link-audit-20261025/headers.ndjson' },
  'viewer-root': { type: 'string', default: '../colmap-webview' } } });
const plan = JSON.parse(await readFile(values.plan)), viewer = resolve(values['viewer-root']);
const scratch = resolve(values.output, '..'); await mkdir(scratch, { recursive: true });
const outfile = resolve(scratch, 'ply-classification.mjs');
await build({ stdin: { contents: `export { classifyPlyHeaderText, getPlyHeaderVertexCount } from ${JSON.stringify(resolve(viewer, 'src/parsers/plyPointCloud.ts'))};`,
  loader: 'ts', resolveDir: viewer }, outfile, bundle: true, platform: 'node', format: 'esm' });
const { classifyPlyHeaderText, getPlyHeaderVertexCount } = await import(pathToFileURL(outfile).href);
const key = asset => [plan.sources[asset.source].sourceId, plan.sources[asset.source].revision, asset.archive, asset.path].join('\0');
const checked = new Map();
try { for (const line of (await readFile(values.output, 'utf8')).split('\n').filter(Boolean)) { const row = JSON.parse(line); checked.set(row.key, row); } }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const timeline = path => /^(?:frame_)?\d{4,}\.(?:ply|spz|splat)$/i.test(path.split('/').at(-1));
const jobs = plan.assets.filter(asset => (asset.owners.length || asset.nameCandidates.length) && !asset.archive
  && !asset.header && !timeline(asset.path) && asset.kind === 'ply' && !checked.has(key(asset)));
let next = 0, completed = 0;
async function check(asset) {
  const source = plan.sources[asset.source];
  if (!source.sourceId.startsWith('hf:') || !/^[a-f0-9]{40}$/.test(source.revision)) throw new Error('Header audit requires a pinned public HF source');
  const url = `https://huggingface.co/datasets/${source.sourceId.slice(3)}/resolve/${source.revision}/${asset.path.split('/').map(encodeURIComponent).join('/')}`;
  const result = { key: key(asset), sourceId: source.sourceId, revision: source.revision, path: asset.path,
    checkedAt: new Date().toISOString(), url, status: 'unavailable' };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { Range: 'bytes=0-65535' }, signal: AbortSignal.timeout(25000) });
      result.httpStatus = response.status;
      if (response.status === 429 || response.status >= 500) {
        await response.body?.cancel();
        if (attempt < 2) { await new Promise(done => setTimeout(done, Math.min(30000, Math.max(3000, Number(response.headers.get('retry-after')) * 1000 || 5000)))); continue; }
      }
      if (!response.ok) { await response.body?.cancel(); break; }
      const reader = response.body.getReader(), chunks = []; let bytes = 0;
      try {
        while (bytes < 65536) {
          const part = await reader.read(); if (part.done) break;
          const chunk = Buffer.from(part.value).subarray(0, 65536 - bytes); chunks.push(chunk); bytes += chunk.length;
          if (Buffer.concat(chunks).includes('end_header')) break;
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const body = Buffer.concat(chunks), text = body.toString('utf8');
      const role = classifyPlyHeaderText(text), count = getPlyHeaderVertexCount(text);
      result.status = 'header_checked'; result.role = role; result.vertices = count;
      result.bytes = Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1]
        ?? response.headers.get('content-length')) || null;
      result.headerBytes = body.length; result.headerSha256 = createHash('sha256').update(body).digest('hex');
      result.allowOrigin = response.headers.get('access-control-allow-origin');
      result.contentRange = response.headers.get('content-range');
      result.headerText = text.slice(0, text.indexOf('end_header') + 10);
      break;
    } catch (error) { result.error = error.message; }
  }
  await appendFile(values.output, JSON.stringify(result) + '\n');
  checked.set(result.key, result);
  if (++completed % 50 === 0) console.log(`Checked ${completed}/${jobs.length} fresh headers`);
}
console.log(`Reusing ${plan.assets.filter(asset => asset.header).length} pinned historical headers; ${jobs.length} new scene-association header candidates; ${checked.size} cached fresh results.`);
await Promise.all(Array.from({ length: 6 }, async () => { while (next < jobs.length) await check(jobs[next++]); }));
const summary = { total: checked.size, roles: {}, failures: 0 };
for (const row of checked.values()) { summary.roles[row.role ?? row.status] = (summary.roles[row.role ?? row.status] ?? 0) + 1; summary.failures += row.status !== 'header_checked'; }
await writeFile(resolve(scratch, 'header-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
