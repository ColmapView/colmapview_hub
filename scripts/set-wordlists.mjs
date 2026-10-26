import { parseArgs } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { openHubDatabase, workerModules } from './lib/hub-database.mjs';

const { values } = parseArgs({ options: { file: { type: 'string' }, remote: { type: 'boolean' }, 'persist-to': { type: 'string' } } });
if (!values.file) throw new Error('Use --file /private/path/wordlists-v1.json [--remote].');
const filename = await realpath(values.file), repo = await realpath('.');
const pathFromRepo = relative(repo, filename);
if (!pathFromRepo.startsWith('..' + sep) && !isAbsolute(pathFromRepo)) throw new Error('Private word lists must stay outside the repository.');
const body = await readFile(filename, 'utf8');
if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('Private word lists are too large.');
const { hubStorage, parseWordlists, WORDLIST_KEY } = await workerModules(['storage', 'records']);
parseWordlists(JSON.parse(body));
const proxy = await openHubDatabase({ remote: values.remote, ...(values['persist-to'] ? { state: values['persist-to'] } : {}) });
try {
  await hubStorage.put(proxy.database, WORDLIST_KEY, body, { createOnly: true });
  const current = await proxy.database.prepare('SELECT body_json FROM hub_settings WHERE key=?').bind(WORDLIST_KEY).first();
  if (current?.body_json !== body) throw new Error('Existing immutable naming configuration differs; it has not been overwritten.');
  console.log('Private naming configuration verified in D1.');
} finally { await proxy.dispose(); }
