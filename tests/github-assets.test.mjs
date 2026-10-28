import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { retainFrontendAssets } from '../scripts/deploy/retain-frontend-assets.mjs';
import { FRONTEND_FILES, GITHUB_ORIGIN, HUB_ORIGIN, pinnedFrontendAssets, sha256 } from '../scripts/lib/github-frontend.mjs';

const githubManifest = GITHUB_ORIGIN + '/hub/deployment.json';
const currentManifest = HUB_ORIGIN + '/hub/assets/github/site.json';
const assetUrl = (bytes, extension) => `${HUB_ORIGIN}/hub/assets/github/${sha256(bytes)}.${extension}`;

function fixture() {
  const resources = new Map(); const calls = []; const snapshots = [];
  for (const [label, manifestUrl, published] of [['published', githubManifest, true], ['current', currentManifest, false]]) {
    const script = Buffer.from(`throw new Error('${label} retained code must never execute');`);
    const style = Buffer.from(`body{--fixture:${label}}`);
    resources.set(assetUrl(script, 'js'), script); resources.set(assetUrl(style, 'css'), style);
    const files = FRONTEND_FILES.map(file => {
      const page = file.startsWith('datasets/') ? 'redirect' : file;
      const bytes = Buffer.from('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'">'
        + `<script type="module" src="${assetUrl(script, 'js')}"></script><link rel="stylesheet" href="${assetUrl(style, 'css')}">`
        + `</head><body>${label} ${page}</body></html>`);
      const hash = sha256(bytes); const artifact = `/hub/assets/github/${hash}.html`;
      resources.set(published ? GITHUB_ORIGIN + '/hub/' + file.replace(/index\.html$/, '') : HUB_ORIGIN + artifact, bytes);
      return { path: file, artifact, sha256: hash, bytes: bytes.length };
    });
    const manifest = { schemaVersion: 2, version: '0.20.1', source: (published ? 'a' : 'b').repeat(40), dirty: false, files };
    resources.set(manifestUrl, JSON.stringify(manifest)); snapshots.push({ manifest, manifestUrl, script, style });
  }
  const fetcher = async (url, options) => {
    assert.ok(resources.has(url), `Unexpected URL: ${url}`);
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    calls.push(url); return new Response(resources.get(url));
  };
  return { resources, calls, snapshots, fetcher };
}

async function freshOutput() {
  await mkdir('.tmp', { recursive: true });
  const output = await mkdtemp('.tmp/github-assets-test-');
  const future = Buffer.from('A newer local client build');
  await writeFile(`${output}/${sha256(future)}.js`, future);
  await writeFile(`${output}/site.json`, 'The new build manifest');
  return { output, future };
}

test('fresh deployments retain the published frontend and in-flight export without overwriting the new build', async () => {
  const { output, future } = await freshOutput(); const data = fixture();
  const retained = await retainFrontendAssets(output, data.fetcher);
  assert.equal(retained.files, 10);
  for (const { manifest, script, style } of data.snapshots) {
    for (const file of manifest.files) assert.equal(sha256(await readFile(`${output}/${file.sha256}.html`)), file.sha256);
    assert.deepEqual(await readFile(`${output}/${sha256(script)}.js`), script);
    assert.deepEqual(await readFile(`${output}/${sha256(style)}.css`), style);
  }
  assert.deepEqual(await readFile(`${output}/${sha256(future)}.js`), future);
  assert.equal(await readFile(`${output}/site.json`, 'utf8'), 'The new build manifest');
  assert.equal((await readdir(output)).length, 12);
  for (const file of FRONTEND_FILES) assert.ok(data.calls.includes(GITHUB_ORIGIN + '/hub/' + file.replace(/index\.html$/, '')));
});

test('invalid export metadata aborts before writing or fetching outside the fixed public origins', async () => {
  for (const mutate of [value => { value.dirty = true; }, value => { value.schemaVersion = 99; },
    value => { value.files[0].path = '../index.html'; }, value => { value.files[0].artifact = 'https://evil.invalid/page.html'; },
    value => { value.files[0].bytes = 1024 * 1024 + 1; }, value => { value.files[1] = value.files[0]; }]) {
    const { output } = await freshOutput(); const data = fixture();
    const manifest = data.snapshots[0].manifest; mutate(manifest);
    data.resources.set(githubManifest, JSON.stringify(manifest));
    await assert.rejects(retainFrontendAssets(output, data.fetcher));
    assert.equal((await readdir(output)).length, 2);
    assert.deepEqual(data.calls, [githubManifest]);
  }
});

test('a changed live document or tampered asset aborts without partially publishing retained files', async () => {
  for (const target of ['document', 'asset']) {
    const { output } = await freshOutput(); const data = fixture();
    data.resources.set(target === 'document' ? GITHUB_ORIGIN + '/hub/' : assetUrl(data.snapshots[0].script, 'js'), 'Changed bytes');
    await assert.rejects(retainFrontendAssets(output, data.fetcher), /length changed|digest mismatch/);
    assert.equal((await readdir(output)).length, 2);
  }
});

test('manifest and asset bodies have streaming size limits', async () => {
  for (const target of ['manifest', 'asset']) {
    const { output } = await freshOutput(); const data = fixture();
    data.resources.set(target === 'manifest' ? githubManifest : assetUrl(data.snapshots[0].script, 'js'),
      Buffer.alloc((target === 'manifest' ? 16 * 1024 : 1024 * 1024) + 1));
    await assert.rejects(retainFrontendAssets(output, data.fetcher), /size limit/);
    assert.equal((await readdir(output)).length, 2);
  }
});

test('a reused HTML digest must have the same byte length in both live descriptors', async () => {
  const { output } = await freshOutput(); const data = fixture();
  const current = data.snapshots[1].manifest;
  current.files = data.snapshots[0].manifest.files.map(file => ({ ...file }));
  current.files[0].bytes++;
  data.resources.set(currentManifest, JSON.stringify(current));
  await assert.rejects(retainFrontendAssets(output, data.fetcher), /descriptors disagree/);
  assert.equal((await readdir(output)).length, 2);
});

test('only pinned scripts and styles are dependency URLs, with a bounded total count', async () => {
  assert.throws(() => pinnedFrontendAssets('<script src="https://evil.invalid/a.js"></script>'), /must pin/);
  const { output } = await freshOutput(); const data = fixture();
  const html = Buffer.from('<!doctype html><html><head>' + Array.from({ length: 33 }, (_, i) =>
    `<script src="${assetUrl(Buffer.from(String(i)), 'js')}"></script>`).join('') + '</head><body>Large graph</body></html>');
  const manifest = data.snapshots[0].manifest;
  manifest.files[0] = { ...manifest.files[0], sha256: sha256(html), artifact: `/hub/assets/github/${sha256(html)}.html`, bytes: html.length };
  data.resources.set(githubManifest, JSON.stringify(manifest)); data.resources.set(GITHUB_ORIGIN + '/hub/', html);
  await assert.rejects(retainFrontendAssets(output, data.fetcher), /too many dependencies/);
  assert.equal((await readdir(output)).length, 2);
});

test('the production deploy retains live assets after the offline build and before the upload', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.match(pkg.scripts.deploy, /^npm run build:assets && node scripts\/deploy\/retain-frontend-assets\.mjs && node scripts\/deploy\/catalog-metadata\.mjs && wrangler deploy$/);
});

test('the deployment CLI rejects an uncommitted build before any public network preparation', async () => {
  const { output } = await freshOutput();
  const directory = path.join(output, 'public/hub/assets/github');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'site.json'), JSON.stringify({ ...fixture().snapshots[0].manifest, dirty: true }));
  const guard = path.resolve(output, 'no-network.mjs');
  await writeFile(guard, "globalThis.fetch = () => { throw new Error('Network ran before source validation'); };\n");
  for (const script of ['retain-frontend-assets.mjs', 'catalog-metadata.mjs']) {
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(guard).href,
      fileURLToPath(new URL('../scripts/deploy/' + script, import.meta.url))], { cwd: output });
    assert.equal(result.status, 1);
    assert.match(result.stderr.toString(), /Live frontend exports must come from a clean commit/);
  }
});
