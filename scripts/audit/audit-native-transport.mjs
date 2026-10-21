/** Anonymous Chromium CORS and registered-photo checks for a native-header plan. */
import { chromium } from '@playwright/test';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { plan: { type: 'string' }, out: { type: 'string' },
  resume: { type: 'boolean' }, jobs: { type: 'string', default: '3' } } });
const jobs = Number(values.jobs);
if (!values.plan || !values.out || !Number.isInteger(jobs) || jobs < 1 || jobs > 6) throw new Error('Use --plan FILE --out DIRECTORY [--resume] [--jobs 3]');
const plan = JSON.parse(await readFile(values.plan, 'utf8'));
if (!/^hf:[^/\s]+\/[^/\s]+$/.test(plan.sourceId) || !/^[a-f0-9]{40}$/.test(plan.revision)) throw new Error('Expected a public pinned source plan');
const prefix = `https://huggingface.co/datasets/${plan.sourceId.slice(3)}/resolve/${plan.revision}/`;
for (const item of plan.models) for (const source of [...Object.values(item.headers || {}), item.photo, item.mask].filter(Boolean)) {
  if (!source.url?.startsWith(prefix)) throw new Error('Model transport escaped its pinned source');
}
const fingerprint = item => createHash('sha256').update(JSON.stringify({ kind: item.kind, path: item.path,
  headers: Object.values(item.headers || {}).map(({ url, sha256, bytes, sourceBytes }) => ({ url, sha256, bytes, sourceBytes })),
  sample: item.sample, photo: item.photo, mask: item.mask })).digest('hex');
const output = resolve(values.out);
await mkdir(output, { recursive: true });
const receipt = resolve(output, 'browser.jsonl'), prior = new Map();
if (values.resume) {
  try { for (const line of (await readFile(receipt, 'utf8')).trim().split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.sourceId === plan.sourceId && row.revision === plan.revision) prior.set(row.path, row);
  } } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const items = plan.models.filter(item => prior.get(item.path)?.status !== 'passed' || prior.get(item.path)?.fingerprint !== fingerprint(item));
const browser = await chromium.launch();
let position = 0, completed = 0, cooldown = 0;
const results = [];
const wait = async () => { while (Date.now() < cooldown) await new Promise(resolve => setTimeout(resolve, Math.min(1000, cooldown - Date.now()))); };
try {
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://colmapview.opsiclear.com/', { waitUntil: 'domcontentloaded' });
    try {
      while (position < items.length) {
        await wait();
        if (position >= items.length) break;
        const item = items[position++];
        for (let attempt = 0; attempt < 3; attempt++) {
          await wait();
          const result = item.errors.length ? { status: 'failed', message: item.errors.join('; ') } : await page.evaluate(async item => {
            const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(b => b.toString(16).padStart(2, '0')).join('');
            const read = async (url, limit) => {
              const response = await fetch(url, { headers: { Range: `bytes=0-${limit - 1}` }, signal: AbortSignal.timeout(45000), credentials: 'omit' });
              if (response.status === 429) {
                const after = response.headers.get('retry-after'), reset = /(?:^|;)\s*t=(\d+)/.exec(response.headers.get('ratelimit') || '');
                throw Object.assign(new Error('Source quota limit'), { retryAfterMs: Math.max(1000, reset ? Number(reset[1]) * 1000 : after && /^\d+$/.test(after) ? Number(after) * 1000 : 300000) });
              }
              if (!response.ok || !response.body) throw new Error(`Source returned ${response.status}`);
              const reader = response.body.getReader(), chunks = [];
              let length = 0;
              try { for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                length += value.length;
                if (length > limit) throw new Error('Source exceeded its bounded read');
                chunks.push(value);
              } } finally { await reader.cancel().catch(() => {}); }
              const bytes = new Uint8Array(length);
              let offset = 0;
              for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
              return { bytes, status: response.status, range: response.headers.get('content-range') };
            };
            const result = { status: 'passed', headers: {} };
            try {
              for (const [role, source] of Object.entries(item.headers)) {
                const limit = role === 'cameras' ? Math.max(65536, source.bytes) : 65536;
                if (limit > 8 * 1024 * 1024) throw new Error('Camera calibration exceeds the explicit 8 MiB audit budget');
                const response = await read(source.url, limit);
                if (response.bytes.length !== source.bytes || source.sourceBytes > limit && response.status !== 206
                  || await hash(response.bytes) !== source.sha256) throw new Error(`Original ${role} prefix changed or ignored Range`);
                result.headers[role] = { sha256: source.sha256, bytes: response.bytes.length, httpStatus: response.status, browserRead: true };
              }
              for (const role of ['photo', 'mask']) if (item[role]) {
                const response = await read(item[role].url, 8 * 1024 * 1024);
                const bitmap = await createImageBitmap(new Blob([response.bytes]));
                const width = bitmap.width, height = bitmap.height;
                bitmap.close();
                if (width !== item.sample.width || height !== item.sample.height) throw new Error(`Registered ${role} dimensions differ from its camera`);
                result[role] = { ...item[role], bytes: response.bytes.length, sha256: await hash(response.bytes),
                  prefixSha256: await hash(response.bytes.slice(0, 65536)), width, height, browserRead: true, pixels: 'decoded' };
              }
            } catch (error) {
              result.status = 'failed'; result.message = error.message;
              if (error.retryAfterMs) result.retryAfterMs = error.retryAfterMs;
            }
            return result;
          }, item);
          const row = { ...result, sourceId: plan.sourceId, revision: plan.revision, path: item.path,
            fingerprint: fingerprint(item), checkedAt: new Date().toISOString() };
          await appendFile(receipt, JSON.stringify(row) + '\n');
          results.push(row);
          if (!row.retryAfterMs || attempt === 2) {
            completed++;
            if (completed % 25 === 0 || row.status !== 'passed') console.log(`${completed}/${items.length}: ${row.status}: ${item.path}${row.message ? ' ' + row.message : ''}`);
            break;
          }
          cooldown = Math.max(cooldown, Date.now() + row.retryAfterMs);
          console.warn(`Provider quota: waiting ${Math.ceil(row.retryAfterMs / 1000)} seconds before retrying.`);
        }
      }
    } finally { await context.close(); }
  }));
} finally { await browser.close(); }
const latest = new Map([...prior.values(), ...results].map(row => [row.path, row]));
const summary = { sourceId: plan.sourceId, revision: plan.revision, checkedAt: new Date().toISOString(),
  total: plan.models.length, passed: plan.models.filter(item => latest.get(item.path)?.status === 'passed'
    && latest.get(item.path)?.fingerprint === fingerprint(item)).length,
  scope: 'Anonymous Chromium reads of exact original native prefixes and decoded registered-photo/mask samples. Full model loading, every photo and export are separate checks.' };
await writeFile(resolve(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
if (summary.passed !== summary.total) process.exitCode = 1;
