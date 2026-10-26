import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { catalogRenderer } from './renderer.mjs';

// Offline export: only public templates and catalog filter choices. Live rows,
// shares and previews stay on the public API; Worker code/configuration never ship.
const index = JSON.parse(await readFile('public/hub/datasets/individual/index.json', 'utf8'));
const { individualIndexPage, page, HUB_UI_VERSION } = await catalogRenderer();
const location = { origin: 'https://colmapview.github.io', path: '/hub', base: 'https://colmapview.github.io/hub',
  local: false, viewerHost: 'github', frontend: 'github' };
const gallery = individualIndexPage(location, index,
  { generation: index.generation, entries: [], total: 0, page: 1, pages: 1 }, new URLSearchParams('viewerHost=github'));
const detail = page(location, 'Dataset', '<p id="catalog-entry-status" role="status">Loading dataset…</p>'
  + '<button id="catalog-entry-retry" type="button" class="button" hidden>Try again</button><div id="catalog-entry"></div>',
  `<script type="module" src="https://colmapview.opsiclear.com/hub/assets/catalog-entry.js?v=${HUB_UI_VERSION}"></script>`, true);
const directory = 'public/hub/assets/github';
await mkdir(directory, { recursive: true });
// Keep old HTML usable while the two frontends deploy independently. These
// immutable public assets are retained; mutable build output is never its dependency.
const pinned = new Map();
for (const name of ['colmapview.css', 'styles.css', 'assets/theme.js', 'assets/client.js',
  'assets/individual-catalog.js', 'assets/catalog-entry.js']) {
  let content = await readFile(`public/hub/${name}`, 'utf8');
  if (name.endsWith('.css')) content = content.replaceAll("url('./fonts/", "url('https://colmapview.opsiclear.com/hub/fonts/");
  const digest = createHash('sha256').update(content).digest('hex');
  const file = `${digest}.${name.endsWith('.css') ? 'css' : 'js'}`;
  await writeFile(`${directory}/${file}`, content);
  pinned.set(`https://colmapview.opsiclear.com/hub/${name}`, `https://colmapview.opsiclear.com/hub/assets/github/${file}`);
}
const files = [];
for (const [paths, template] of [[['index.html', 'datasets/index.html'], gallery], [['datasets/entry/index.html'], detail]]) {
  let html = template;
  for (const [original, immutable] of pinned) html = html.replaceAll(`${original}?v=${HUB_UI_VERSION}`, immutable).replaceAll(original, immutable);
  for (const [, tag, attributes] of html.matchAll(/<(script|link)\b([^>]+)>/g)) {
    if (tag === 'link' && !attributes.includes('rel="stylesheet"')) continue;
    const reference = /(?:src|href)="([^"]+)"/.exec(attributes)?.[1];
    if (reference && !/^https:\/\/colmapview\.opsiclear\.com\/hub\/assets\/github\/[a-f0-9]{64}\.(?:js|css)$/.test(reference)) {
      throw new Error('GitHub templates must pin every frontend script and stylesheet.');
    }
  }
  const bytes = Buffer.from(html);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const artifact = `/hub/assets/github/${sha256}.html`;
  await writeFile(`${directory}/${sha256}.html`, bytes);
  for (const path of paths) files.push({ path, artifact, sha256, bytes: bytes.length });
}
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
await writeFile(`${directory}/site.json`, JSON.stringify({ schemaVersion: 1, version,
  source: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])), files }, null, 2) + '\n');
console.log(`Exported GitHub Hub frontend ${version}: ${files.length} pages, public API data loaded asynchronously.`);
