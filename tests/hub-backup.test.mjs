import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { openHubDatabase } from '../scripts/lib/hub-database.mjs';

test('restores large settings and binary previews into D1 without embedding large SQL literals or replacing existing state', { timeout: 60000 }, async t => {
  await mkdir('.tmp', { recursive: true });
  const parent = await realpath('.tmp');
  const directory = await mkdtemp(join(parent, 'hub-backup-test-'));
  const state = join(directory, 'state'), filename = join(directory, 'backup.sql');
  let proxy;
  t.after(async () => {
    await proxy?.dispose();
    assert.equal(dirname(await realpath(directory)), parent);
    await rm(directory, { recursive: true, force: true });
  });
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const settings = JSON.stringify({ version: 1, synthetic: "Unicode ' © ".repeat(18000) });
  const preview = Buffer.from(Uint8Array.from({ length: 64 * 1024 }, (_, index) => index % 256));
  const body = JSON.stringify({ title: "Synthetic ' scene", viewerUrl: 'https://example.org/model.zip' });
  assert.ok(Buffer.byteLength(settings) > 100000);
  const schema = await readFile('migrations/0001_hub_records.sql', 'utf8');
  await writeFile(filename, schema
    + `\nINSERT INTO hub_settings VALUES ('internal/wordlists-v1.json',${quote(settings)},${Buffer.byteLength(settings)});`
    + `\nINSERT INTO hub_entries (namespace,id,body_json,preview_jpeg,source_bytes) VALUES ('links','HappyTree',${quote(body)},X'${preview.toString('hex')}',${Buffer.byteLength(body)});\n`);
  const run = () => spawnSync(process.execPath, ['scripts/restore-hub-backup.mjs', '--file', filename, '--persist-to', state],
    { cwd: resolve('.'), encoding: 'utf8' });
  const restored = run();
  assert.equal(restored.status, 0, restored.stderr || restored.stdout);
  const refused = run();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /already exists/);
  proxy = await openHubDatabase({ state });
  const record = await proxy.database.prepare("SELECT body_json,preview_jpeg FROM hub_entries WHERE namespace='links' AND id='HappyTree'").first();
  assert.equal(record.body_json, body);
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(Buffer.from(record.preview_jpeg)), sha(preview));
  const setting = await proxy.database.prepare("SELECT body_json,source_bytes FROM hub_settings WHERE key='internal/wordlists-v1.json'").first();
  assert.equal(setting.body_json, settings);
  assert.equal(setting.source_bytes, Buffer.byteLength(settings));
});
