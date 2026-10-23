import { copyFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const test = process.argv.includes('--test');
const port = process.env.HUB_DEV_PORT || '5201';
if (!/^\d{2,5}$/.test(port) || Number(port) > 65535) throw new Error('HUB_DEV_PORT must be a valid port number');
const state = test ? `.tmp/browser-state-${Date.now()}` : '.wrangler/state';
const cli = 'node_modules/wrangler/bin/wrangler.js';
if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');
const seed = spawnSync(process.execPath, [cli, 'r2', 'object', 'put', 'colmapview-hub/internal/wordlists-v1.json', '--local', '--persist-to', state, '--file', 'tests/fixtures/dev-wordlists.json'], { stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
// Keep bindings local and give each worktree its own inspector port.
const child = spawn(process.execPath, [cli, 'dev', '--local', '--port', port, '--inspector-port', '0', '--local-upstream', `localhost:${port}`, '--upstream-protocol', 'http', '--persist-to', state, '--var', `HUB_ORIGIN:http://localhost:${port}`], { stdio: 'inherit', env: { ...process.env, BROWSER: 'none' } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
