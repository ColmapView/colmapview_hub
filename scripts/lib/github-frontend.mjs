import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const HUB_ORIGIN = 'https://colmapview.opsiclear.com';
export const GITHUB_ORIGIN = 'https://colmapview.github.io';
export const FRONTEND_FILES = ['index.html', 'entry/index.html', 'datasets/index.html', 'datasets/entry/index.html'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateFrontendManifest(value) {
  assert.equal(value.schemaVersion, 2);
  assert.match(value.version, /^\d+\.\d+\.\d+$/);
  assert.match(value.source, /^[a-f0-9]{40}$/);
  assert.equal(value.dirty, false, 'Live frontend exports must come from a clean commit.');
  assert.equal(value.files?.length, FRONTEND_FILES.length);
  assert.deepEqual(value.files.map(file => file.path).sort(), [...FRONTEND_FILES].sort());
  for (const file of value.files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/);
    assert.equal(file.artifact, `/hub/assets/github/${file.sha256}.html`);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 100 && file.bytes <= 1024 * 1024);
  }
  return value;
}

/** Only bundled, content-hashed files on the fixed public CDN are dependencies. */
export function pinnedFrontendAssets(html) {
  const assets = new Set();
  for (const [, tag, attributes] of html.matchAll(/<(script|link)\b([^>]+)>/gi)) {
    if (tag.toLowerCase() === 'link' && !/\brel=["']stylesheet["']/i.test(attributes)) continue;
    const reference = /(?:^|\s)(?:src|href)=["']([^"']+)["']/i.exec(attributes)?.[1];
    if (!reference) continue;
    assert.match(reference, /^https:\/\/colmapview\.opsiclear\.com\/hub\/assets\/github\/[a-f0-9]{64}\.(?:js|css)$/,
      'GitHub templates must pin every frontend script and stylesheet.');
    assets.add(reference);
  }
  assert.ok(assets.size, 'Frontend HTML must reference its pinned assets.');
  return assets;
}
