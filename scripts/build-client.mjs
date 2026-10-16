import { build } from 'esbuild';

await build({ entryPoints: ['src/client/index.ts'], outfile: 'public/hub/assets/client.js', bundle: true, minify: true, target: 'es2022', format: 'esm' });
await build({ entryPoints: ['src/client/catalog.ts'], outfile: 'public/hub/assets/catalog.js', bundle: true, minify: true, target: 'es2022', format: 'esm' });
await build({ entryPoints: ['src/client/individual-catalog.ts'], outfile: 'public/hub/assets/individual-catalog.js', bundle: true, minify: true, target: 'es2022', format: 'esm' });
