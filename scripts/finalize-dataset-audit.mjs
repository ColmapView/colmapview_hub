import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { makeDatasetAudit } from './dataset-audit-import.mjs';

const { values } = parseArgs({ options: { dir: { type: 'string', default: '.tmp/full-audit' },
  'viewer-version': { type: 'string' }, 'allow-partial-browser': { type: 'boolean' } } });
if (!values['viewer-version']) throw new Error('--viewer-version must name the deployed viewer compatibility target');
const directory = resolve(values.dir);
const reports = await Promise.all(['hf-audit.json', 'public-audit.json', 'browser-audit.json'].map(async file => JSON.parse(await readFile(resolve(directory, file), 'utf8'))));
if (!values['allow-partial-browser'] && reports[2].completed !== reports[2].total) throw new Error('Browser audit is incomplete');
let viewerReport;
try { viewerReport = JSON.parse(await readFile(resolve(directory, 'viewer-audit.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const audit = makeDatasetAudit(...reports, values['viewer-version'], viewerReport);
audit.browserCoverage = { completed: reports[2].completed, total: reports[2].total };
await writeFile('data/dataset-audit.json', JSON.stringify(audit, null, 2) + '\n');
console.log(JSON.stringify({ sources: audit.results.length, headerChecked: audit.results.filter(result => result.level === 'header_checked').length,
  browserReadable: audit.results.filter(result => result.delivery === 'browser_readable').length, browserCoverage: audit.browserCoverage }));
