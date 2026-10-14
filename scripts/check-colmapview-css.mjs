import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// public/hub/colmapview.css is a byte-for-byte copy of colmap-webview/public/policy.css.
// colmap-webview/src/theme/policyCssCopy.test.ts pins the same hash: change both files and both hashes together.
const PINNED = '3f4a63e60475947785a400fc0e804ffe1b011f558beca064d127db266ed1409e';
const text = readFileSync(new URL('../public/hub/colmapview.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const actual = createHash('sha256').update(text).digest('hex');
if (actual !== PINNED) {
  console.error(`public/hub/colmapview.css changed (sha256 ${actual}). It must stay a copy of colmap-webview/public/policy.css: `
    + 'copy the viewer\'s file here, then update the pinned hash in this script and in colmap-webview/src/theme/policyCssCopy.test.ts.');
  process.exit(1);
}
