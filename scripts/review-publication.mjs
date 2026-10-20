import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const { values } = parseArgs({ options: { id: { type: 'string' }, approve: { type: 'boolean' }, reject: { type: 'boolean' },
  remote: { type: 'boolean' }, 'checked-public': { type: 'boolean' }, 'checked-format': { type: 'boolean' }, 'persist-to': { type: 'string' } } });
if (!values.id || !/^[A-Z][a-z]{2,13}[A-Z][a-z]{2,13}-L[A-Za-z0-9_-]{16}$/.test(values.id) || values.approve && values.reject) {
  throw new Error('Use --id ID, and at most one of --approve or --reject. Operations default to local storage; production requires --remote.');
}
if (values.approve && (!values['checked-public'] || !values['checked-format'])) throw new Error('Approval requires --checked-public and --checked-format after inspecting the source anonymously and loading the dataset.');
await mkdir('.tmp/publication-review', { recursive: true });
const scratch = await mkdtemp(resolve('.tmp/publication-review/run-'));
const pendingFile = resolve(scratch, 'pending.json');
const cli = resolve('node_modules/wrangler/bin/wrangler.js');
const storage = values.remote ? ['--remote'] : ['--local', ...(values['persist-to'] ? ['--persist-to', values['persist-to']] : [])];
const pending = `colmapview-hub/pending-publications/${values.id}.json`;
const listed = `colmapview-hub/listed/${values.id}.json`;
const run = args => spawnSync(process.execPath, [cli, 'r2', 'object', ...args, ...storage], { encoding: 'utf8' });
const requireSuccess = result => { if (result.status !== 0) throw new Error(result.stderr || 'R2 operation failed.'); };
requireSuccess(run(['get', pending, '--file', pendingFile]));
const record = JSON.parse(await readFile(pendingFile, 'utf8'));
await build({ entryPoints: ['src/worker/publication-review.ts'], outfile: resolve(scratch, 'review.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24' });
const { reviewPublication } = await import(pathToFileURL(resolve(scratch, 'review.mjs')).href);
const approved = reviewPublication(record);
if (approved.id !== values.id) throw new Error('The record ID does not match its storage key.');
const previewFile = resolve(scratch, 'preview.jpg');
await writeFile(previewFile, Buffer.from(approved.thumbnailBase64, 'base64'));
console.log(JSON.stringify({ id: approved.id, title: approved.title, description: approved.description, viewerUrl: approved.viewerUrl,
  license: approved.license ?? null, assets: approved.assets ?? null, previewFile, reviewReason: record.reviewReason ?? null }, null, 2));
if (values.approve) {
  const existingFile = resolve(scratch, 'existing.json');
  const existing = run(['get', listed, '--file', existingFile]);
  if (existing.status === 0) {
    const previous = JSON.parse(await readFile(existingFile, 'utf8'));
    if (previous.ownerHash !== approved.ownerHash || previous.fingerprint !== approved.fingerprint) throw new Error('A different record already owns this ID.');
  } else {
    if (!/404|does not exist|not found/i.test(existing.stderr + existing.stdout)) requireSuccess(existing);
    const output = resolve(scratch, 'approved.json');
    await writeFile(output, JSON.stringify(approved));
    requireSuccess(run(['put', listed, '--file', output, '--content-type', 'application/json']));
  }
  requireSuccess(run(['delete', pending, '--force']));
  console.log('Published the reviewed dataset on Hub.');
} else if (values.reject) {
  requireSuccess(run(['delete', pending, '--force']));
  console.log('Removed this pending submission.');
} else console.log('Inspection only. Approve after checking public access and dataset format, or reject this submission.');
