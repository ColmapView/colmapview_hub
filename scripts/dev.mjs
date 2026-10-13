import { copyFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const test = process.argv.includes('--test');
const state = test ? `.tmp/browser-state-${Date.now()}` : '.wrangler/state';
const cli = 'node_modules/wrangler/bin/wrangler.js';
if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars');
const seed = spawnSync(process.execPath, [cli, 'r2', 'object', 'put', 'colmapview-hub/internal/wordlists-v1.json', '--local', '--persist-to', state, '--file', 'tests/fixtures/dev-wordlists.json'], { stdio: 'inherit' });
if (seed.status !== 0) process.exit(seed.status ?? 1);
const child = spawn(process.execPath, [cli, 'dev', '--port', '5201', '--local-upstream', 'localhost:5201', '--upstream-protocol', 'http', '--persist-to', state, '--var', 'HUB_ORIGIN:http://localhost:5201', '--var', 'TURNSTILE_SITE_KEY:1x00000000000000000000AA'], { stdio: 'inherit', env: { ...process.env, BROWSER: 'none' } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 0));
