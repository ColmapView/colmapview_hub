import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { auditViewerSample } from './audit-viewer-sample.mjs';

const { values } = parseArgs({ options: { cli: { type: 'string' }, dir: { type: 'string', default: '.tmp/full-audit' },
  cwd: { type: 'string', default: '.tmp' }, session: { type: 'string', default: 'dataset-samples' }, plan: { type: 'string', default: 'sample-plan.json' } } });
if (!values.cli) throw new Error('--cli must name the installed @playwright/cli/playwright-cli.js');
const directory = resolve(values.dir);
const input = JSON.parse(await readFile(resolve(directory, values.plan), 'utf8'));
const plan = Array.isArray(input) ? input : [input];
let results = [];
try { results = JSON.parse(await readFile(resolve(directory, 'viewer-audit.json'), 'utf8')).results; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const item of plan) {
  const setup = item.manifest ? `await page.route(${JSON.stringify(item.url)}, route => route.fulfill({ status: 200, contentType: 'application/json', body: ${JSON.stringify(JSON.stringify(item.manifest))} }));` : '';
  const teardown = item.manifest ? `await page.unroute(${JSON.stringify(item.url)});` : '';
  const code = `async page => { ${setup} const result = await (${auditViewerSample.toString()})(page, ${JSON.stringify(item)}); ${teardown} return result; }`;
  const output = spawnSync(process.execPath, [resolve(values.cli), `-s=${values.session}`, 'run-code', code],
    { cwd: resolve(values.cwd), encoding: 'utf8', timeout: 125000, maxBuffer: 1024 * 1024 });
  const match = /### Result\r?\n([\s\S]*?)(?=\r?\n### |$)/.exec(output.stdout || '');
  if (output.status || !match) throw new Error(`Viewer sample driver failed for ${item.id}`);
  const result = JSON.parse(match[1]);
  results = results.filter(previous => previous.sourceId !== result.sourceId);
  results.push(result);
  await writeFile(resolve(directory, 'viewer-audit.json'), JSON.stringify({ schemaVersion: 1, checkedAt: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify({ sourceId: result.sourceId, status: result.status, message: result.message }));
}
