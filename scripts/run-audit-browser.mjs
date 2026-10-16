import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { auditBrowserBatch } from './audit-browser-transport.mjs';

const { values } = parseArgs({ options: { cli: { type: 'string' }, dir: { type: 'string', default: '.tmp/full-audit' },
  cwd: { type: 'string', default: '.tmp' }, session: { type: 'string', default: 'dataset-audit' } } });
if (!values.cli) throw new Error('--cli must name the installed @playwright/cli/playwright-cli.js');
const directory = resolve(values.dir);
const plan = JSON.parse(await readFile(resolve(directory, 'browser-plan.json'), 'utf8'));
const receipt = resolve(directory, 'browser-audit.json');
let results = [];
try { results = JSON.parse(await readFile(receipt, 'utf8')).results; } catch (error) { if (error.code !== 'ENOENT') throw error; }
const plannedUrls = new Set(plan.map(item => item.url));
results = results.filter(result => plannedUrls.has(result.url));
const done = new Set(results.map(result => result.url));
const pending = plan.filter(item => !done.has(item.url));
if (!pending.length) await writeFile(receipt, JSON.stringify({ schemaVersion: 1, origin: 'https://colmapview.opsiclear.com',
  checkedAt: new Date().toISOString(), completed: results.length, total: plan.length,
  scope: 'Anonymous browser prefix reads and exact archive tail ranges. No complete scene render or image decode certification.', results }));
await mkdir(resolve(directory, 'browser-logs'), { recursive: true });
for (let offset = 0; offset < pending.length; offset += 32) {
  const items = pending.slice(offset, offset + 32);
  const code = `async page => await page.evaluate(${auditBrowserBatch.toString()}, ${JSON.stringify(items)})`;
  // Arguments go directly to Node, never through a shell containing source URLs or code.
  const output = spawnSync(process.execPath, [resolve(values.cli), `-s=${values.session}`, 'run-code', code],
    { cwd: resolve(values.cwd), encoding: 'utf8', timeout: 110000, maxBuffer: 1024 * 1024 });
  const text = output.stdout || '';
  const match = /### Result\r?\n([\s\S]*?)(?=\r?\n### |$)/.exec(text);
  await writeFile(resolve(directory, `browser-logs/batch-${offset}.txt`), text + (output.stderr || ''));
  if (output.status || !match) throw new Error(`Browser audit batch ${offset} failed; see the local receipt log`);
  const batch = JSON.parse(match[1]);
  if (!Array.isArray(batch) || batch.length !== items.length) throw new Error('Incomplete browser audit batch');
  results.push(...batch);
  const report = { schemaVersion: 1, origin: 'https://colmapview.opsiclear.com', checkedAt: new Date().toISOString(),
    completed: results.length, total: plan.length,
    scope: 'Anonymous browser prefix reads and exact archive tail ranges. No complete scene render or image decode certification.', results };
  await writeFile(receipt, JSON.stringify(report));
  console.log(JSON.stringify({ completed: results.length, total: plan.length,
    passed: results.filter(result => result.delivery === 'browser_readable').length }));
}
