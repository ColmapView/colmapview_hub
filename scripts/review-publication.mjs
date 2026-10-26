import { parseArgs } from 'node:util';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openHubDatabase, workerModules } from './lib/hub-database.mjs';

const { values } = parseArgs({ options: { id: { type: 'string' }, approve: { type: 'boolean' }, reject: { type: 'boolean' },
  remote: { type: 'boolean' }, 'checked-public': { type: 'boolean' }, 'checked-format': { type: 'boolean' }, 'persist-to': { type: 'string' } } });
if (!values.id || !/^[A-Z][a-z]{2,13}[A-Z][a-z]{2,13}-L[A-Za-z0-9_-]{16}$/.test(values.id) || values.approve && values.reject) {
  throw new Error('Use --id ID, and at most one of --approve or --reject. Operations default to local storage; production requires --remote.');
}
if (values.approve && (!values['checked-public'] || !values['checked-format'])) throw new Error('Approval requires --checked-public and --checked-format after inspecting the source anonymously and loading the dataset.');
await mkdir('.tmp/publication-review', { recursive: true });
const scratch = await mkdtemp(resolve('.tmp/publication-review/run-'));
const proxy = await openHubDatabase({ remote: values.remote, ...(values['persist-to'] ? { state: values['persist-to'] } : {}) });
try {
  const { hubStorage, reviewPublication, approvePublication } = await workerModules(['storage', 'publication-review']);
  const key = `pending-publications/${values.id}.json`;
  const stored = await hubStorage.get(proxy.database, key);
  if (!stored || stored.size > 192 * 1024) throw new Error('Pending submission unavailable.');
  const record = await stored.json();
  const approved = reviewPublication(record);
  if (approved.id !== values.id) throw new Error('The record ID does not match its storage key.');
  const previewFile = resolve(scratch, 'preview.jpg');
  await writeFile(previewFile, Buffer.from(approved.thumbnailBase64, 'base64'));
  console.log(JSON.stringify({ id: approved.id, title: approved.title, description: approved.description, viewerUrl: approved.viewerUrl,
    license: approved.license ?? null, assets: approved.assets ?? null, previewFile, reviewReason: record.reviewReason ?? null }, null, 2));
  if (values.approve) {
    await approvePublication(proxy.database, approved);
    console.log('Published the reviewed dataset on Hub.');
  } else if (values.reject) {
    await hubStorage.delete(proxy.database, key);
    console.log('Removed this pending submission.');
  } else console.log('Inspection only. Approve after checking public access and dataset format, or reject this submission.');
} finally { await proxy.dispose(); }
