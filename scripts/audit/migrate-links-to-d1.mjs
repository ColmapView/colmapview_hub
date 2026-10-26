import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { openHubDatabase, workerModules } from '../lib/hub-database.mjs';

const flags = process.argv.slice(2);
if (!flags.includes('--remote') || flags.some(flag => !['--remote', '--apply', '--verify', '--incremental'].includes(flag))
  || flags.includes('--apply') && flags.includes('--verify')) throw new Error('Use --remote [--apply | --verify] [--incremental]; no mutation by default.');
const apply = flags.includes('--apply'), verify = flags.includes('--verify');
const directory = '.tmp/d1-migration-20261026';
const snapshotFile = `${directory}/source-inventory.json`;
const prior = flags.includes('--incremental') ? JSON.parse(await readFile(snapshotFile, 'utf8')) : { version: 1, entries: {} };
if (prior.version !== 1 || !prior.entries || typeof prior.entries !== 'object') throw new Error('A fully verified migration snapshot is required.');
const checkpoints = {};
const digest = row => createHash('sha256').update(JSON.stringify([row.body_json, row.source_bytes, row.listing_json ?? null,
  createHash('sha256').update(Buffer.from(row.preview_jpeg ?? [])).digest('hex'), row.title ?? null, row.created_at ?? null,
  row.owner_hash ?? null, row.fingerprint ?? null, row.publication_verified ?? null])).digest('hex');
const listing = object => JSON.stringify(Object.entries(object.customMetadata ?? {}).sort());
const expectedDigest = (object, body, fields) => body === undefined ? prior.entries[object.key].digest : object.key.startsWith('internal/')
  ? digest({ body_json: body, source_bytes: object.size })
  : digest({ body_json: fields.body, preview_jpeg: fields.preview, source_bytes: fields.bytes, listing_json: fields.listing,
    title: fields.title, created_at: fields.createdAt, owner_hash: fields.ownerHash, fingerprint: fields.fingerprint, publication_verified: fields.verified });
const remember = (object, row, expected) => {
  if (!row || digest(row) !== expected) throw new Error('Record, configuration or preview mismatch; no cutover.');
  checkpoints[object.key] = { etag: object.etag, size: object.size, listing: listing(object), digest: expected };
};
async function remote(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 3 || !/fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(error) + String(error?.cause))) throw error;
      await delay(500 * 2 ** attempt);
    }
  }
}
const proxy = await openHubDatabase({ remote: true, legacySource: true });
try {
  const { hubStorage, entryInsert, storedFields, WORDLIST_KEY } = await workerModules();
  const objects = [];
  let cursor;
  do {
    const page = await remote(() => proxy.legacy.list({ limit: 1000, include: ['customMetadata'], ...(cursor ? { cursor } : {}) }));
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const selected = objects.filter(object => object.key === WORDLIST_KEY || /^(links|listed|pending-publications)\/[^/]{1,128}\.json$/.test(object.key));
  const counts = {};
  for (const object of selected) {
    const namespace = object.key.split('/')[0];
    counts[namespace] = (counts[namespace] ?? 0) + 1;
    if (object.size > (object.key === WORDLIST_KEY ? 1024 * 1024 : 192 * 1024)) throw new Error('An oversized legacy record needs inspection; no cutover.');
  }
  console.log(JSON.stringify({ mode: apply ? 'apply' : verify ? 'verify' : 'plan', records: selected.length, counts,
    sourceBytes: selected.reduce((sum, object) => sum + object.size, 0), excludedObjects: objects.length - selected.length }));
  if (!apply && !verify) process.exitCode = 0;
  else {
    let checked = 0, inserted = 0;
    for (let start = 0; start < selected.length; start += 40) {
      const batch = selected.slice(start, start + 40);
      const bodies = [];
      for (let offset = 0; offset < batch.length; offset += 8) {
        bodies.push(...await Promise.all(batch.slice(offset, offset + 8).map(async object => {
          const previous = prior.entries[object.key];
          if (previous?.etag === object.etag && previous.size === object.size && previous.listing === listing(object)) return undefined;
          const value = await remote(() => proxy.legacy.get(object.key));
          if (!value || value.etag !== object.etag || value.size !== object.size) throw new Error('Legacy data changed during migration; rerun before cutover.');
          return value.text();
        })));
      }
      const entries = batch.map((object, index) => ({ object, body: bodies[index] }));
      const settings = entries.filter(({ object }) => object.key === WORDLIST_KEY);
      const records = entries.filter(({ object }) => object.key !== WORDLIST_KEY);
      const changed = records.filter(entry => entry.body !== undefined);
      if (apply && changed.length) {
        const results = await remote(() => proxy.database.batch(changed.map(({ object, body }) =>
          entryInsert(proxy.database, object.key, body, { createOnly: true, ...(Object.keys(object.customMetadata ?? {}).length ? { listing: object.customMetadata } : {}) }))));
        inserted += results.reduce((sum, result) => sum + result.meta.changes, 0);
      }
      for (const { object, body } of settings) {
        if (apply && body !== undefined && await remote(() => hubStorage.put(proxy.database, object.key, body, { createOnly: true }))) inserted++;
        const row = await remote(() => proxy.database.prepare('SELECT body_json,source_bytes FROM hub_settings WHERE key=?').bind(object.key).first());
        remember(object, row, expectedDigest(object, body));
      }
      if (records.length) {
        const parameters = records.flatMap(({ object }) => {
          const [namespace, filename] = object.key.split('/');
          return [namespace, filename.slice(0, -5)];
        });
        // Forty indexed keys fit under D1's 100-parameter bound in one read.
        const where = records.map(() => '(namespace=? AND id=?)').join(' OR ');
        const result = await remote(() => proxy.database.prepare(`SELECT * FROM hub_entries WHERE ${where}`).bind(...parameters).all());
        const rows = new Map(result.results.map(row => [`${row.namespace}/${row.id}.json`, row]));
        records.forEach(({ object, body }) => {
          const fields = body === undefined ? undefined : storedFields(body, Object.keys(object.customMetadata ?? {}).length ? object.customMetadata : undefined);
          remember(object, rows.get(object.key), expectedDigest(object, body, fields));
        });
      }
      checked += batch.length;
      if (checked % 400 === 0 || checked === selected.length) console.log(JSON.stringify({ checked, inserted }));
    }
    const totals = (await remote(() => proxy.database.prepare(`SELECT namespace,count(*) AS records,sum(length(body_json)) AS metadataBytes,
      sum(coalesce(length(preview_jpeg),0)) AS previewBytes FROM hub_entries GROUP BY namespace`).all())).results;
    for (const namespace of ['links', 'listed', 'pending-publications']) {
      if ((totals.find(total => total.namespace === namespace)?.records ?? 0) !== (counts[namespace] ?? 0)) {
        throw new Error('Database contains records absent from the legacy snapshot; reconcile deletions before cutover.');
      }
    }
    await mkdir(directory, { recursive: true });
    await writeFile(snapshotFile, JSON.stringify({ version: 1, entries: checkpoints }) + '\n', { mode: 0o600 });
    await writeFile('.tmp/d1-migration-20261026/receipt.json', JSON.stringify({ checkedAt: new Date().toISOString(), counts, checked, inserted, totals }, null, 2) + '\n');
    console.log(JSON.stringify({ verified: checked, inserted, totals }));
  }
} finally { await proxy.dispose(); }
