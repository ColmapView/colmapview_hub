import { build } from 'esbuild';

await build({ entryPoints: ['src/client/index.ts'], outfile: 'public/hub/assets/client.js', bundle: true, minify: true, target: 'es2022', format: 'esm' });
