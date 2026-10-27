import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { GITHUB_ORIGIN, HUB_ORIGIN, pinnedFrontendAssets, sha256, validateFrontendManifest } from '../lib/github-frontend.mjs';

const MAX_ASSET_BYTES = 1024 * 1024;
const MAX_FILES = 32;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

async function readPublic(url, max, fetcher) {
  const response = await fetcher(url, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `Cannot retain live frontend: ${url} returned ${response.status}.`);
  assert.ok(response.body, 'Live frontend response has no body.');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      assert.ok(size <= max, 'Live frontend file exceeds its size limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

/** Deployment only: preserve live GitHub dependencies and downloads already using the current Hub export. */
export async function retainFrontendAssets(directory, fetcher = fetch) {
  const files = new Map();
  const dependencies = new Set();
  let totalBytes = 0;
  const retain = (name, bytes) => {
    assert.match(name, /^[a-f0-9]{64}\.(?:html|css|js)$/);
    assert.equal(sha256(bytes), name.slice(0, 64), 'Live frontend digest mismatch.');
    if (files.has(name)) return;
    totalBytes += bytes.length;
    assert.ok(files.size < MAX_FILES && totalBytes <= MAX_TOTAL_BYTES, 'Live frontend retention exceeds its budget.');
    files.set(name, bytes);
  };
  const snapshots = [
    { manifest: `${GITHUB_ORIGIN}/hub/deployment.json`, published: true },
    { manifest: `${HUB_ORIGIN}/hub/assets/github/site.json`, published: false },
  ];
  for (const snapshot of snapshots) {
    const manifest = validateFrontendManifest(JSON.parse(await readPublic(snapshot.manifest, 16 * 1024, fetcher)));
    for (const file of manifest.files) {
      const name = `${file.sha256}.html`;
      if (files.has(name) && !snapshot.published) {
        assert.equal(files.get(name).length, file.bytes, 'Live frontend HTML descriptors disagree.');
        continue;
      }
      const url = snapshot.published ? `${GITHUB_ORIGIN}/hub/${file.path.replace(/index\.html$/, '')}` : HUB_ORIGIN + file.artifact;
      const bytes = await readPublic(url, file.bytes, fetcher);
      assert.equal(bytes.length, file.bytes, 'Live frontend HTML length changed; wait for publication and retry.');
      retain(name, bytes);
      const html = bytes.toString('utf8');
      assert.ok(html.startsWith('<!doctype html>'));
      for (const asset of pinnedFrontendAssets(html)) dependencies.add(asset);
    }
  }
  assert.ok(files.size + dependencies.size <= MAX_FILES, 'Live frontend has too many dependencies.');
  for (const url of dependencies) {
    const name = new URL(url).pathname.split('/').at(-1);
    retain(name, await readPublic(url, MAX_ASSET_BYTES, fetcher));
  }
  // Downloaded bytes are never executed. Write only verified hash filenames; keep the new site.json untouched.
  await mkdir(directory, { recursive: true });
  for (const [name, bytes] of files) await writeFile(path.join(directory, name), bytes);
  return { files: files.size, bytes: totalBytes };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const directory = 'public/hub/assets/github';
  validateFrontendManifest(JSON.parse(await readFile(path.join(directory, 'site.json'), 'utf8')));
  const retained = await retainFrontendAssets(directory);
  console.log(`Retained ${retained.files} verified live frontend files (${retained.bytes} bytes).`);
}
