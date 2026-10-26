import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { applyLocalMigrations, openHubDatabase } from './lib/hub-database.mjs';

const { values } = parseArgs({ options: { file: { type: 'string' }, remote: { type: 'boolean' }, 'persist-to': { type: 'string' } } });
if (!values.file) throw new Error('Use --file /private/backup.sql with --persist-to NEW_DIRECTORY, or --remote for an empty migrated database.');
if (!values.remote) {
  if (!values['persist-to']) throw new Error('Local restores require --persist-to NEW_DIRECTORY.');
  try { await stat(values['persist-to']); throw new Error('Restore state directory already exists; choose a new directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
} else if (values['persist-to']) throw new Error('Choose either a local state directory or --remote.');

// Only use trusted operator exports. SQL runs in a separate, in-memory SQLite database.
const source = new DatabaseSync(':memory:');
const tables = [
  { name: 'hub_entries', columns: ['namespace', 'id', 'body_json', 'preview_jpeg', 'source_bytes', 'listing_json',
    'title', 'created_at', 'owner_hash', 'fingerprint', 'publication_verified'] },
  { name: 'hub_settings', columns: ['key', 'body_json', 'source_bytes'] },
];
let proxy;
try {
  source.exec(await readFile(values.file, 'utf8'));
  if (source.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
  for (const table of tables) {
    const columns = source.prepare(`PRAGMA table_info(${table.name})`).all().map(row => row.name).sort();
    if (JSON.stringify(columns) !== JSON.stringify([...table.columns].sort())) throw new Error('Backup schema does not match this Hub version.');
    table.rows = source.prepare(`SELECT ${table.columns.join(',')} FROM ${table.name}`).all();
  }
  if (!values.remote) applyLocalMigrations(values['persist-to']);
  proxy = await openHubDatabase({ remote: values.remote, ...(values['persist-to'] ? { state: values['persist-to'] } : {}) });
  const database = proxy.database;
  // Check both tables before writing either; never merge old records into a live database.
  const occupied = await database.batch(tables.map(table => database.prepare(`SELECT 1 FROM ${table.name} LIMIT 1`)));
  if (occupied.some(result => result.results.length)) throw new Error('Restore requires an empty migrated database. Existing records were not changed.');
  for (const table of tables) {
    const sql = `INSERT INTO ${table.name} (${table.columns.join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`;
    for (let start = 0; start < table.rows.length; start += 50) {
      const batch = table.rows.slice(start, start + 50);
      // Bind large settings and binary previews instead of embedding them in SQL text.
      await database.batch(batch.map(row => database.prepare(sql).bind(...table.columns.map(column => row[column]))));
    }
    const copied = await database.prepare(`SELECT COUNT(*) AS total FROM ${table.name}`).first();
    if (copied.total !== table.rows.length) throw new Error('Restored row count does not match the backup.');
  }
  console.log(JSON.stringify({ restored: true, remote: Boolean(values.remote),
    entries: tables[0].rows.length, settings: tables[1].rows.length }));
} finally { source.close(); await proxy?.dispose(); }
