/** Validate every manifest locally; optionally load every one through the real viewer. */
import { chromium } from '@playwright/test';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { manifestPlan, viewerManifestSchemas, compareManifestCounts, manifestHash, manifestLoadSummary } from './manifest-plan.mjs';

const { values } = parseArgs({ options: {
  'viewer-root': { type: 'string', default: '../colmap-webview' },
  scratch: { type: 'string', default: '.tmp/manifest-audit' },
  load: { type: 'boolean' }, resume: { type: 'boolean' },
  limit: { type: 'string' }, offset: { type: 'string', default: '0' },
  source: { type: 'string' }, manifest: { type: 'string', multiple: true },
  shard: { type: 'string' },
  jobs: { type: 'string', default: '2' }, port: { type: 'string', default: '5193' },
  'max-mib': { type: 'string', default: '256' }, 'timeout-ms': { type: 'string', default: '120000' },
  help: { type: 'boolean' },
} });
if (values.help) {
  console.log('Usage: npm run catalog:manifests -- --viewer-root PATH [--load] [--resume] [--source hf:owner/repo] [--manifest HASH.manifest.json] [--shard 1/4] [--limit N] [--offset N] [--jobs 2] [--max-mib 256] [--timeout-ms 120000] [--scratch PATH]');
  process.exit(0);
}
const viewer = resolve(values['viewer-root']), scratch = resolve(values.scratch);
const options = { jobs: Number(values.jobs), offset: Number(values.offset), limit: values.limit === undefined ? Infinity : Number(values.limit),
  maxBytes: Number(values['max-mib']) * 1024 * 1024, timeout: Number(values['timeout-ms']), port: Number(values.port) };
for (const key of ['jobs', 'offset', 'maxBytes', 'timeout', 'port']) if (!Number.isSafeInteger(options[key]) || options[key] < (key === 'offset' ? 0 : 1)) throw new Error(`Invalid ${key}`);
if (options.jobs > 8 || options.port > 65535 || options.timeout < 1000 || options.limit !== Infinity && (!Number.isSafeInteger(options.limit) || options.limit < 1)) throw new Error('Invalid audit limits');
const shard = values.shard ? /^(\d{1,2})\/(\d{1,2})$/.exec(values.shard) : null;
if (values.shard && (!shard || Number(shard[1]) < 1 || Number(shard[1]) > Number(shard[2]))) throw new Error('Use a shard such as 1/4');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: viewer, encoding: 'utf8' }).trim();
if (execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: viewer, encoding: 'utf8' }).trim()) throw new Error('Commit viewer source changes before recording a reproducible audit');
await mkdir(scratch, { recursive: true });
const plan = await manifestPlan(process.cwd(), await viewerManifestSchemas(viewer));
await writeFile(resolve(scratch, 'plan.json'), JSON.stringify({ ...plan, viewerCommit: commit }, null, 2) + '\n');
const invalid = plan.manifests.filter(item => item.errors.length);
console.log(`${plan.scenes} scene entries, ${plan.sources} sources; ${plan.manifests.length} manifest schemas checked, ${invalid.length} invalid, ${plan.missing.length} missing.`);
if (invalid.length || plan.missing.length) {
  for (const item of invalid) console.error(item.file + ': ' + item.errors.join('; '));
  process.exitCode = 1;
} else if (values.load) {
  const requested = values.manifest;
  if (requested?.some(file => !plan.manifests.some(item => item.file === file))) throw new Error('Unknown manifest');
  const matching = plan.manifests.filter(item => (!values.source || item.entries.some(entry => entry.source === values.source))
    && (!requested || requested.includes(item.file)));
  if (!matching.length) throw new Error('No manifests matched');
  let selection = matching.filter((_, i) => !shard || i % Number(shard[2]) === Number(shard[1]) - 1)
    .slice(options.offset, options.offset + options.limit);
  if (!selection.length && !shard) throw new Error('No manifests in the requested range');
  const receipt = resolve(scratch, 'loads.jsonl');
  const prior = new Map();
  if (values.resume) {
    try {
      for (const line of (await readFile(receipt, 'utf8')).trim().split('\n').filter(Boolean)) {
        const row = JSON.parse(line);
        if (row.viewerCommit === commit && row.generation === plan.generation) prior.set(row.manifest, row);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    selection = selection.filter(item => {
      const previous = prior.get(item.file);
      return !previous || previous.status !== 'passed' || previous.sha256 !== item.sha256 || previous.sourceUrl !== item.url || !previous.actual
        || compareManifestCounts(previous.actual, item.entries).length || item.requiresSplat && !previous.splatDecoded;
    });
  }
  const origin = `http://localhost:${options.port}`;
  // Spawn only this audit's server; never attach to or stop a developer's server.
  const server = spawn(process.execPath, [resolve(viewer, 'node_modules/vite/bin/vite.js'), '--host', 'localhost', '--port', String(options.port), '--strictPort'],
    { cwd: viewer, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog = (serverLog + chunk).slice(-4000); });
  server.stderr.on('data', chunk => { serverLog = (serverLog + chunk).slice(-4000); });
  let browser;
  const results = [];
  try {
    let ready = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && server.exitCode === null) {
      ready = serverLog.includes('Local:') && await fetch(origin, { signal: AbortSignal.timeout(1000) }).then(response => response.ok).catch(() => false);
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready || server.exitCode !== null) throw new Error('Audit viewer server did not start: ' + serverLog);
    browser = await chromium.launch({ args: ['--enable-webgl', '--use-gl=angle', '--ignore-gpu-blocklist',
      // Match the viewer's Linux software-WebGPU test configuration so archive
      // Gaussian counts are observable even on CI runners without a hardware GPU.
      ...(process.platform === 'linux' ? ['--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--enable-features=Vulkan', '--use-vulkan=swiftshader'] : [])] });
    let position = 0;
    await Promise.all(Array.from({ length: Math.min(options.jobs, selection.length) }, async () => {
      // Keep HTTP/compiled-resource caches warm without retaining an app page,
      // credentials, persisted preferences or a previous reconstruction.
      const context = await browser.newContext({ viewport: { width: 1000, height: 720 } });
      await context.addInitScript(() => { globalThis.localStorage.clear(); globalThis.sessionStorage.clear(); });
      try {
        while (position < selection.length) {
          const item = selection[position++];
          await context.clearCookies();
          const result = await loadManifest(context, origin, item, options);
          const row = { ...result, sha256: item.sha256, manifest: item.file, viewerCommit: commit, generation: plan.generation, checkedAt: new Date().toISOString() };
          await appendFile(receipt, JSON.stringify(row) + '\n');
          results.push(row);
          console.log(`${results.length}/${selection.length} ${row.status}: ${item.file}${row.message ? ' ' + row.message.slice(0, 150) : ''}`);
        }
      } finally { await context.close(); }
    }));
  } finally {
    await browser?.close();
    server.kill();
    await writeFile(resolve(scratch, 'server.log'), serverLog);
  }
  const summary = { checkedAt: new Date().toISOString(), generation: plan.generation, viewerCommit: commit,
    ...manifestLoadSummary(plan, [...prior.values(), ...results], commit), ...(values.shard ? { shard: values.shard } : {}), attemptedThisRun: results.length,
    scope: 'Original immutable manifests fetched in Chromium; real viewer imports and parsed camera/pose/point counts, Gaussian frame counts, canvas, and required splat decoder validation. Optional photographs/masks and exports are not exhaustively tested. Budget/timeout/provider failures never count as passes.' };
  await writeFile(resolve(scratch, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  if (results.some(row => row.status !== 'passed')) process.exitCode = 1;
}

async function loadManifest(context, origin, item, options) {
  const started = Date.now();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const external = new Set();
  const methods = new Map();
  let bytes = 0, budget = false, budgetReason, expired = false, manifestBody, decoder = false, decodedSplats, decoderError;
  const pageErrors = [], httpErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message.slice(0, 500)));
  page.on('console', message => {
    if (/\[Splats\] Validated|\[WebGPU Splats\] Loaded/.test(message.text())) {
      decoder = true;
      const count = /\b([0-9][0-9,]*) (?:gaussians|splats)\b/.exec(message.text());
      if (count) decodedSplats = Number(count[1].replaceAll(',', ''));
    }
    if (/\[Splats\] Failed to load/.test(message.text())) decoderError = message.text().slice(0, 500);
  });
  page.on('response', response => {
    if (response.url() === item.url && response.request().method() !== 'HEAD') manifestBody = response.body().then(body => ({ status: response.status(), sha256: manifestHash(body) })).catch(error => ({ error: error.message }));
  });
  const stop = reason => {
    if (!budget) { budget = true; budgetReason = reason; void page.close().catch(() => {}); }
  };
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => methods.set(requestId, request.method));
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    if (new URL(response.url).origin === origin || !/^https?:/.test(response.url)) return;
    external.add(requestId);
    if (response.status >= 400) httpErrors.push({ status: response.status, url: response.url.split('?')[0] });
    const size = Number(response.headers['content-length'] ?? response.headers['Content-Length']);
    // A multi-GB lazy archive may need only a tiny range. HEAD declares the
    // container size, not bytes transferred, and must not spend that budget.
    if (methods.get(requestId) !== 'HEAD' && size > options.maxBytes) stop(`Response declares ${size} bytes, above the ${options.maxBytes}-byte limit: ${response.url.split('?')[0]}`);
  });
  cdp.on('Network.dataReceived', event => { if (external.has(event.requestId)) { bytes += event.dataLength; if (bytes > options.maxBytes) stop(`Received more than ${options.maxBytes} external response bytes`); } });
  const result = { status: 'inconclusive', url: item.url, entries: item.entries.map(entry => entry.id), maxBytes: options.maxBytes, timeoutMs: options.timeout };
  const timer = setTimeout(() => { expired = true; void page.close().catch(() => {}); }, options.timeout);
  try {
    await page.goto(`${origin}/?e2eProbe=1&url=${encodeURIComponent(item.url)}`, { waitUntil: 'domcontentloaded', timeout: options.timeout });
    let state;
    const deadline = Date.now() + options.timeout;
    do {
      state = await page.evaluate(async () => {
        const module = '/src/store/reconstructionStore.ts';
        const { useReconstructionStore } = await import(module);
        const state = useReconstructionStore.getState(), rec = state.reconstruction;
        return { loading: state.loading || state.urlLoading || state.urlLoadActive, error: state.error || state.urlError,
          counts: rec ? { cameras: rec.cameras.size, images: rec.images.size, points: rec.globalStats.totalPoints } : null,
          splat: Boolean(state.loadedFiles?.splatFile), sourceUrl: state.sourceUrl };
      });
      if (!state.loading && (state.counts || state.error)) break;
      await page.waitForTimeout(250);
    } while (Date.now() < deadline);
    result.actual = state.counts;
    result.sourceUrl = state.sourceUrl;
    result.manifestRead = await manifestBody;
    const mismatches = state.counts ? [] : ['No reconstruction committed'];
    if (state.counts && (state.counts.cameras < 1 || state.counts.images < 1)) mismatches.push('No posed camera dataset loaded');
    if (state.error) mismatches.push(JSON.stringify(state.error));
    if (state.loading) mismatches.push('Load did not finish');
    if (state.sourceUrl !== item.url) mismatches.push('Loaded source differs from this manifest');
    if (result.manifestRead?.status !== 200 || result.manifestRead?.sha256 !== item.sha256) mismatches.push('Browser did not read the exact manifest bytes');
    if (item.requiresSplat && !state.splat) mismatches.push('Required Gaussian frame was not selected');
    if (state.splat) {
      await page.locator('canvas').first().waitFor({ state: 'attached', timeout: 10000 });
      const decoderDeadline = Date.now() + Math.min(45000, options.timeout);
      while (!decoder && !decoderError && Date.now() < decoderDeadline) await page.waitForTimeout(100);
      result.splatDecoded = decoder;
      if (decodedSplats !== undefined && result.actual) result.actual.splats = decodedSplats;
      if (!decoder || decoderError) mismatches.push(decoderError || 'Splat decoder did not validate the selection');
    }
    if (result.actual) mismatches.push(...compareManifestCounts(result.actual, item.entries));
    await page.evaluate(async () => { await globalThis.__COLMAP_WEBVIEW_E2E__?.waitForRenderFrames(2); });
    result.canvases = await page.locator('canvas').count();
    if (!result.canvases) mismatches.push('No rendering canvas');
    if (pageErrors.length) mismatches.push(...pageErrors);
    result.status = mismatches.length ? 'failed' : 'passed';
    if (mismatches.length) result.message = mismatches.join('; ');
  } catch (error) {
    result.status = budget ? 'budget_exceeded' : 'inconclusive';
    result.message = budgetReason || (expired ? `Manifest loading exceeded ${options.timeout} ms` : error.message.slice(0, 800));
  } finally {
    clearTimeout(timer);
    result.bytes = bytes;
    result.elapsedMs = Date.now() - started;
    result.httpErrors = httpErrors;
    await page.close();
  }
  return result;
}
