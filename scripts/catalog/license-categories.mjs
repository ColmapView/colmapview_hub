import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const rulesUrl = new URL('../../src/shared/license-categories.ts', import.meta.url);
const result = await build({ entryPoints: [fileURLToPath(rulesUrl)], bundle: true, write: false, platform: 'node', format: 'esm' });
const { classifyLicense } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);

export async function applyLicenseCategories(snapshot) {
  for (const entry of snapshot.entries) entry.licenseCategory = classifyLicense(entry.license);
  snapshot.sources = snapshot.sources.filter(source => source.kind !== 'license-categories');
  snapshot.sources.push({ kind: 'license-categories', name: 'src/shared/license-categories.ts', checkedAt: '2026-10-16',
    sha256: createHash('sha256').update((await readFile(rulesUrl, 'utf8')).replace(/\r\n/g, '\n')).digest('hex'), rowCount: snapshot.entries.length });
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL('../../data/catalog.json', import.meta.url);
  const snapshot = await applyLicenseCategories(JSON.parse(await readFile(path, 'utf8')));
  const temporary = new URL('../../data/catalog.json.tmp', import.meta.url);
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`);
  await rename(temporary, path);
  console.log(JSON.stringify(snapshot.entries.reduce((counts, entry) => {
    counts[entry.licenseCategory] = (counts[entry.licenseCategory] || 0) + 1;
    return counts;
  }, {}), null, 2));
}
