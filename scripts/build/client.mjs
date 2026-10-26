import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await build({ entryPoints: ['src/client/theme.ts'], outfile: 'public/hub/assets/theme.js', bundle: true, minify: true, target: 'es2022', format: 'iife' });

await build({ entryPoints: ['src/client/index.ts'], outfile: 'public/hub/assets/client.js', bundle: true, minify: true, target: 'es2022', format: 'esm' });
await rm('public/hub/assets/catalog.js', { force: true });
await build({ entryPoints: ['src/client/individual-catalog.ts'], outfile: 'public/hub/assets/individual-catalog.js', bundle: true, minify: true, target: 'es2022', format: 'esm' });
await build({ entryPoints: ['src/client/catalog-entry.ts'], outfile: 'public/hub/assets/catalog-entry.js', bundle: true, minify: true, target: 'es2022', format: 'esm' });
