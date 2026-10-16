import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { publicUrl } from './catalog-import.mjs';

const { values } = parseArgs({ options: { dir: { type: 'string', default: '.tmp/full-audit' } } });
const directory = resolve(values.dir);
const reports = await Promise.all(['hf-audit.json', 'public-audit.json'].map(async file => JSON.parse(await readFile(resolve(directory, file), 'utf8'))));
const urls = new Map();
let imports = [];
try { imports = JSON.parse(await readFile(resolve(directory, 'viewer-audit.json'), 'utf8')).results; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const opened = new Set(imports.map(result => result.sourceId));
for (const report of reports) for (const result of report.results) {
  if (result.level !== 'header_checked' && !opened.has(result.sourceId) && result.sourceId.startsWith('hf:')) continue;
  const probes = result.probes.filter(probe => probe.url);
  if (!probes.length && result.url) probes.push({ url: result.url });
  for (const probe of probes) {
    const url = publicUrl(probe.url);
    if (!url) continue;
    const previous = urls.get(url);
    if (previous) previous.sources.push(result.sourceId);
    else urls.set(url, { url, zip: /\.zip(?:\/content)?$/i.test(decodeURIComponent(new URL(url).pathname)),
      sizeBytes: probe.sizeBytes || 0, sources: [result.sourceId] });
  }
}
const plan = [...urls.values()];
await writeFile(resolve(directory, 'browser-plan.json'), JSON.stringify(plan));
console.log(JSON.stringify({ urls: plan.length, sources: new Set(plan.flatMap(item => item.sources)).size, archiveUrls: plan.filter(item => item.zip).length }));
