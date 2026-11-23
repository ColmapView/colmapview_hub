import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// public/hub/colmapview.css is a byte-for-byte copy of colmap-webview/public/policy.css.
// colmap-webview/src/theme/policyCssCopy.test.ts pins the same hash: change both files and both hashes together.
const PINNED = '0f45f4f10386496861760fe68b396e530084fc29714741800a96f5e03200a247';
const text = readFileSync(new URL('../public/hub/colmapview.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const actual = createHash('sha256').update(text).digest('hex');
if (actual !== PINNED) {
  console.error(`public/hub/colmapview.css changed (sha256 ${actual}). It must stay a copy of colmap-webview/public/policy.css: `
    + 'copy the viewer\'s file here, then update the pinned hash in this script and in colmap-webview/src/theme/policyCssCopy.test.ts.');
  process.exit(1);
}
