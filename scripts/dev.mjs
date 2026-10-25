import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

const test = process.argv.includes('--test');
const port = process.env.HUB_DEV_PORT || '5201';
if (!/^\d{2,5}$/.test(port) || Number(port) > 65535) throw new Error('HUB_DEV_PORT must be a valid port number');
// Fail before seeding storage or starting Wrangler. Browser readiness now uses
// Wrangler's ready signal rather than probing its proxy during initialization.
for (const host of ['127.0.0.1', '::1']) {
  await new Promise((resolve, reject) => {
    const probe = createServer(socket => socket.destroy());
    probe.once('error', error => {
      if (host === '::1' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) resolve();
      else reject(new Error(`Hub port ${port} is unavailable on ${host}. Choose a different HUB_DEV_PORT.`, { cause: error }));
    });
    probe.listen(Number(port), host, () => probe.close(error => error ? reject(error) : resolve()));
  });
}
const state = test ? `.tmp/browser-state-${Date.now()}` : '.wrangler/state';
const cli = 'node_modules/wrangler/bin/wrangler.js';
if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');
const seed = spawnSync(process.execPath, [cli, 'r2', 'object', 'put', 'colmapview-hub/internal/wordlists-v1.json', '--local', '--persist-to', state, '--file', 'tests/fixtures/dev-wordlists.json'], { stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
// Browser tests use an explicit local app shell, never the network or a deployed viewer.
let viewerOrigin = process.env.HUB_VIEWER_ORIGIN;
let viewerFixture;
if (test && !viewerOrigin) {
  const document = readFileSync(new URL('../tests/fixtures/viewer-document.html', import.meta.url));
  viewerFixture = createHttpServer((_, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'strict-origin',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' });
    response.end(document);
  });
  await new Promise((resolve, reject) => {
    viewerFixture.once('error', reject);
    viewerFixture.listen(0, '127.0.0.1', resolve);
  });
  viewerOrigin = `http://127.0.0.1:${viewerFixture.address().port}`;
}
const viewerArgs = viewerOrigin ? ['--var', `HUB_VIEWER_ORIGIN:${viewerOrigin}`] : [];
// Keep bindings local and give each worktree its own inspector port.
const child = spawn(process.execPath, [cli, 'dev', '--local', '--port', port, '--inspector-port', '0', '--local-upstream', `localhost:${port}`, '--upstream-protocol', 'http', '--persist-to', state, '--var', `HUB_ORIGIN:http://localhost:${port}`, ...viewerArgs], { stdio: 'inherit', env: { ...process.env, BROWSER: 'none' } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { viewerFixture?.close(); process.exit(code ?? 0); });
