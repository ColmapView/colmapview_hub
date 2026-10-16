import { build } from 'esbuild';

export async function catalogRenderer() {
  const result = await build({ entryPoints: ['src/worker/catalog-pages.ts', 'src/shared/catalog.ts'], bundle: true, write: false,
    outdir: '.tmp/catalog-renderer', platform: 'node', format: 'esm', target: 'es2022' });
  const modules = await Promise.all(result.outputFiles.map(file => import(`data:text/javascript;base64,${Buffer.from(file.contents).toString('base64')}`)));
  return Object.assign({}, ...modules);
}
