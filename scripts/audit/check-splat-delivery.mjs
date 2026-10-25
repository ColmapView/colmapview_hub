/** Fresh, resumable availability/size/CORS checks for every selected Gaussian. */
import { readFile, appendFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { policy: { type: 'string', default: 'data/gaussian-routing.json.gz' },
  scratch: { type: 'string', default: '.tmp/splat-link-audit-20261025' } } });
await mkdir(values.scratch, { recursive: true });
const bytes = await readFile(values.policy), policy = JSON.parse(gunzipSync(bytes));
const assets = [...new Map(policy.routes.flatMap(route => route.assets.map(asset => [asset.url, asset]))).values()];
const file = `${values.scratch}/delivery.ndjson`, checked = new Map();
try { for (const line of (await readFile(file, 'utf8')).split('\n').filter(Boolean)) { const row = JSON.parse(line); checked.set(row.url, row); } }
catch (error) { if (error.code !== 'ENOENT') throw error; }
let next = 0, nextStart = Date.now(), completed = 0;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < assets.length) {
    const asset = assets[next++], previous = checked.get(asset.url);
    if (previous?.status === 'passed' && previous.bytes === asset.bytes) { completed++; continue; }
    const delay = Math.max(0, nextStart - Date.now()); nextStart = Math.max(Date.now(), nextStart) + 125;
    await wait(delay);
    const row = { url: asset.url, bytes: asset.bytes, checkedAt: new Date().toISOString() };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(asset.url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await wait(Math.min(30000, Math.max(1000, Number(response.headers.get('retry-after')) * 1000 || (attempt + 1) * 3000)));
          continue;
        }
        row.httpStatus = response.status;
        row.allowOrigin = response.headers.get('access-control-allow-origin');
        row.sourceBytes = Number(response.headers.get('content-range')?.split('/').at(-1) ?? response.headers.get('content-length'));
        row.status = response.ok && ['*', 'https://colmapview.opsiclear.com'].includes(row.allowOrigin)
          && row.sourceBytes === asset.bytes ? 'passed' : 'failed';
        break;
      } catch (error) { row.status = 'failed'; row.error = error.message; if (attempt < 2) await wait(1000); }
    }
    checked.set(asset.url, row);
    await appendFile(file, JSON.stringify(row) + '\n');
    if (++completed % 250 === 0) console.log(`${completed}/${assets.length} checked`);
  }
}));
const results = assets.map(asset => checked.get(asset.url));
const summary = { checkedAt: new Date().toISOString(), policySha256: createHash('sha256').update(bytes).digest('hex'),
  total: assets.length, passed: results.filter(row => row.status === 'passed').length,
  failed: results.filter(row => row.status !== 'passed'),
  scope: 'Fresh anonymous HEAD responses, exact source byte lengths and viewer CORS. Format headers and scene associations have separate receipts; full downloads and renders are not implied.' };
await writeFile(`${values.scratch}/delivery-summary.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
if (summary.failed.length) process.exitCode = 1;
