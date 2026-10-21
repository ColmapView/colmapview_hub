import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { manifestHash } from '../scripts/audit/manifest-plan.mjs';

const run = promisify(execFile);
const viewer = process.env.COLMAPVIEW_AUDIT_VIEWER_ROOT;
const temporary = resolve('.tmp');
const listen = server => new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
const close = server => new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()));

async function fixture() {
  await mkdir(temporary, { recursive: true });
  const scratch = await mkdtemp(resolve(temporary, 'manifest-runner-test-'));
  const name = (await readdir('public/hub/datasets/individual/manifests')).find(name => /^[a-f0-9]{64}\.manifest\.json$/.test(name));
  assert.ok(name);
  return { scratch, name, args: ['scripts/audit/audit-manifests.mjs', '--viewer-root', resolve(viewer), '--load', '--manifest', name,
    '--shard', '2/2', '--scratch', scratch],
  cleanup: async () => {
    assert.ok(resolve(scratch).startsWith(temporary + sep));
    await rm(scratch, { recursive: true, force: true });
  } };
}

test('quiet CI starts and stops its own viewer with an empty shard and makes no passing-load claim', { skip: !viewer, timeout: 90000 }, async () => {
  const state = await fixture();
  const reservation = createServer();
  await listen(reservation);
  const port = reservation.address().port;
  await close(reservation);
  try {
    await run(process.execPath, [...state.args, '--port', String(port)], { env: { ...process.env, CI: 'true' }, timeout: 85000 });
    const summary = JSON.parse(await readFile(resolve(state.scratch, 'summary.json'), 'utf8'));
    assert.equal(summary.attemptsThisRun, 0);
    assert.equal(summary.statuses.passed, 0);
    assert.equal(summary.untested, summary.total);
    assert.equal(summary.selected.total, 0);
    // A successful exit must also release the exact port for the next run.
    const released = createServer();
    await new Promise((accept, reject) => { released.once('error', reject); released.listen(port, '127.0.0.1', accept); });
    await close(released);
  } finally { await state.cleanup(); }
});

test('resuming a retained budget exclusion stays incomplete even without new load attempts', { skip: !viewer, timeout: 90000 }, async () => {
  const state = await fixture();
  const reservation = createServer();
  await listen(reservation);
  const port = reservation.address().port;
  await close(reservation);
  try {
    const index = JSON.parse(await readFile('public/hub/datasets/individual/index.json', 'utf8'));
    const bytes = await readFile(resolve('public/hub/datasets/individual/manifests', state.name));
    const viewerCommit = (await run('git', ['rev-parse', 'HEAD'], { cwd: viewer })).stdout.trim();
    await writeFile(resolve(state.scratch, 'loads.jsonl'), JSON.stringify({ manifest: state.name, sha256: manifestHash(bytes),
      generation: index.generation, viewerCommit, status: 'budget_exceeded', maxBytes: 256 * 1024 * 1024,
      budgetReason: 'Response declares more than the test budget' }) + '\n');
    const args = [...state.args];
    args[args.indexOf('2/2')] = '1/1';
    await assert.rejects(run(process.execPath, [...args, '--resume', '--port', String(port)], { env: { ...process.env, CI: 'true' }, timeout: 85000 }),
      error => error.code === 1);
    const summary = JSON.parse(await readFile(resolve(state.scratch, 'summary.json'), 'utf8'));
    assert.equal(summary.attemptsThisRun, 0);
    assert.equal(summary.selected.total, 1);
    assert.equal(summary.selected.statuses.budget_exceeded, 1);
    assert.equal(summary.selected.statuses.passed, 0);
  } finally { await state.cleanup(); }
});

test('an occupied developer port is rejected before requesting or stopping that server', { skip: !viewer, timeout: 45000 }, async () => {
  const state = await fixture();
  let requests = 0;
  const existing = createServer((request, response) => { requests++; response.end('Existing developer server'); });
  await listen(existing);
  try {
    const port = existing.address().port;
    await assert.rejects(run(process.execPath, [...state.args, '--port', String(port)], { timeout: 40000 }), error => {
      assert.match(error.stderr, /EADDRINUSE/);
      return true;
    });
    assert.equal(requests, 0);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'Existing developer server');
  } finally { await close(existing); await state.cleanup(); }
});
