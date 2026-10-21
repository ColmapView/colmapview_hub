/** Local inventory only. Network loading is deliberately a separate operator step. */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

export const manifestHash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));

/** HF documents seconds-to-reset in RateLimit; also honor standard Retry-After.
 * https://huggingface.co/docs/hub/rate-limits#http-headers */
export function providerRetryDelay(headers, now = Date.now()) {
  const values = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value).trim()]));
  const reset = /(?:^|;)\s*t=(\d+)/.exec(values.ratelimit || '');
  const after = values['retry-after'];
  const explicit = after === undefined ? NaN : /^\d+(?:\.\d+)?$/.test(after) ? Number(after) * 1000 : Date.parse(after) - now;
  const delays = [reset ? Number(reset[1]) * 1000 : NaN, explicit].filter(Number.isFinite);
  return Math.max(1000, delays.length ? Math.max(...delays) : 300000);
}

export async function viewerManifestSchemas(viewerRoot) {
  const result = await build({ stdin: { contents: [
    `export { ColmapManifestSchema } from ${JSON.stringify(resolve(viewerRoot, 'src/types/manifest.ts'))};`,
    `export { CameraDatasetManifestSchema } from ${JSON.stringify(resolve(viewerRoot, 'src/types/cameraDatasetManifest.ts'))};`,
  ].join('\n'), resolveDir: viewerRoot, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}

export function manifestLaunchUrl(viewerUrl) {
  if (!viewerUrl) return null;
  const target = new URL(viewerUrl).searchParams.get('url');
  if (!target) return null;
  const url = new URL(target);
  return url.origin === 'https://colmapview.opsiclear.com'
    && /^\/hub\/datasets\/individual\/manifests\/[a-f0-9]{64}\.manifest\.json$/.test(url.pathname) ? url.href : null;
}

export async function manifestPlan(root, schemas) {
  const directory = resolve(root, 'public/hub/datasets/individual');
  const index = await json(resolve(directory, 'index.json'));
  const selections = new Set((await json(resolve(root, 'data/scene-manifests.json'))).scenes.map(scene => scene.selectionSha256 + '.manifest.json'));
  const references = new Map();
  const add = row => {
    const url = manifestLaunchUrl(row[7]?.viewerUrl);
    if (!url) return;
    const proof = row[7];
    const evidence = proof.sceneManifest?.counts ?? proof.sceneValidation ?? proof.sceneCompatibility;
    const expected = evidence ? Object.fromEntries(['cameras', 'images', 'points'].map(key => [key, evidence[key] ?? null])) : null;
    if (expected && proof.sceneManifest?.frameGeometry?.role === 'splat') expected.splats = proof.sceneManifest.frameGeometry.count;
    const list = references.get(url) ?? [];
    const manifestSha256 = proof.sceneManifest?.sha256 ?? proof.photoRouting?.sha256 ?? proof.photoArchiveRouting?.sha256;
    list.push({ id: row[0], source: index.sources[row[1]].sourceId, path: row[3], expected, ...(manifestSha256 ? { manifestSha256 } : {}) });
    references.set(url, list);
  };
  for (let pack = 0; pack < Math.ceil(index.total / index.packSize); pack++) for (const row of await json(resolve(directory, `packs/${pack}.json`))) add(row);
  if (index.groupedVariants) {
    for (const name of await readdir(resolve(directory, 'variants'))) {
      if (/^[a-f0-9]{2}\.json$/.test(name)) for (const row of Object.values(await json(resolve(directory, 'variants', name)))) add(row);
    }
  }
  const manifests = [];
  for (const file of (await readdir(resolve(directory, 'manifests'))).sort()) {
    if (!/^[a-f0-9]{64}\.manifest\.json$/.test(file)) continue;
    const bytes = await readFile(resolve(directory, 'manifests', file));
    const url = `https://colmapview.opsiclear.com/hub/datasets/individual/manifests/${file}`;
    const sha256 = manifestHash(bytes);
    const errors = [];
    let manifest;
    try {
      manifest = JSON.parse(bytes);
      const schema = manifest.format === 'colmapview-camera-dataset' ? schemas.CameraDatasetManifestSchema : schemas.ColmapManifestSchema;
      const parsed = schema.safeParse(manifest);
      if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`));
    } catch (error) { errors.push(error.message); }
    const entries = references.get(url) ?? [];
    // Explicit scene selections use a digest of their complete selection receipt
    // as the filename, while other manifests use a digest of the JSON bytes.
    // Their separate, published body checksum is the integrity contract.
    if (!selections.has(file) && file !== sha256 + '.manifest.json') errors.push('Manifest filename is neither its content digest nor a recorded selection digest');
    for (const entry of entries) if (entry.manifestSha256 && entry.manifestSha256 !== sha256) errors.push(`${entry.id}: manifest body disagrees with its evidence checksum`);
    for (const key of ['cameras', 'images', 'points', 'splats']) {
      const counts = new Set(entries.map(entry => entry.expected?.[key]).filter(value => value != null));
      if (counts.size > 1) errors.push(`Entries disagree about selected ${key} count`);
    }
    manifests.push({ file, url, sha256, requiresSplat: Boolean(manifest?.geometryFiles?.some(file => file.role === 'splat')),
      addressing: selections.has(file) ? 'selection' : 'content',
      bytes: bytes.length, version: manifest?.version, format: manifest?.format ?? 'colmap', entries, errors });
    references.delete(url);
  }
  return { schemaVersion: 1, generation: index.generation, checkedAt: new Date().toISOString(),
    scenes: index.total, sources: index.sources.length, manifests, missing: [...references.keys()] };
}

export function compareManifestCounts(actual, entries) {
  const mismatches = [];
  for (const entry of entries) for (const key of ['cameras', 'images', 'points', 'splats']) {
    const expected = entry.expected?.[key];
    if (expected != null && actual[key] !== expected) mismatches.push(`${entry.id}: ${key} expected ${expected}, loaded ${actual[key]}`);
  }
  return mismatches;
}

export function manifestLoadSummary(plan, rows, viewerCommit) {
  const manifests = new Map(plan.manifests.map(item => [item.file, item]));
  const latest = new Map();
  for (const row of rows) {
    const item = manifests.get(row.manifest);
    if (!item || row.generation !== plan.generation || row.viewerCommit !== viewerCommit || row.sha256 !== item.sha256) continue;
    if (row.status === 'passed' && (!row.actual || row.sourceUrl !== item.url
      || compareManifestCounts(row.actual, item.entries).length || item.requiresSplat && !row.splatDecoded)) continue;
    latest.set(row.manifest, row);
  }
  return { total: plan.manifests.length,
    statuses: Object.fromEntries(['passed', 'failed', 'inconclusive', 'budget_exceeded'].map(status => [status, [...latest.values()].filter(row => row.status === status).length])),
    untested: plan.manifests.filter(item => !latest.has(item.file)).length };
}
