import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Load the selected viewer's real parsers, schema and bounded video index in an operator process. */
export async function videoFrameTools(viewerRoot, scratch) {
  const viewer = resolve(viewerRoot), directory = resolve(scratch);
  await mkdir(directory, { recursive: true });
  const exports = {
    'src/utils/manifestValidation.ts': ['validateColmapManifest'],
    'src/parsers/cameras.ts': ['parseCamerasBinary'],
    'src/parsers/images.ts': ['parseImagesBinary'],
    'src/dataset/video/videoInput.ts': ['createVideoInput', 'readVideoTrack'],
    'src/dataset/video/videoFrameSelection.ts': ['indexVideoTrack'],
    'src/dataset/video/encodedVideoWindow.ts': ['readEncodedVideoWindow'],
  };
  const outfile = resolve(directory, 'viewer-video-tools.mjs');
  await build({ stdin: { contents: Object.entries(exports).map(([file, names]) =>
    `export {${names}} from ${JSON.stringify(resolve(viewer, file))};`).join('\n') + "\nexport { EncodedPacketSink } from 'mediabunny';", resolveDir: viewer, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile,
  plugins: [{ name: 'anonymous-operator-transport', setup(b) {
    b.onResolve({ filter: /fetchDatasetResource$/ }, () => ({ path: 'transport', namespace: 'audit' }));
    b.onLoad({ filter: /.*/, namespace: 'audit' }, () => ({ contents: `
      export const fetchDatasetResource = (url, timeout, options = {}) => {
        const source = new URL(url);
        if (source.protocol !== 'https:' || source.username || source.password || source.hash) throw new Error('Operator sources require public credential-free HTTPS.');
        return fetch(source, {...options, signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(timeout)])});
      };
      export const fetchDatasetRequest = fetchDatasetResource;`, loader: 'js' }));
  } }] });
  return import(pathToFileURL(outfile).href + '?' + Date.now());
}
