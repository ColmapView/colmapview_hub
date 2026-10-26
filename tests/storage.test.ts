import { env } from 'cloudflare:workers';
import { beforeEach, expect, it, vi } from 'vitest';
import { approvePublication, reviewPublication } from '../src/worker/publication-review';
import { hash } from '../src/worker/crypto';
import { sharedDatasets } from '../src/worker/publications';
import { recordKey } from '../src/worker/records';
import { hubStorage } from '../src/worker/storage';
import { decodePreview } from '../src/worker/validation';
import { preview } from './fixtures/preview';
import { create, input, remove, resetState } from './helpers';

beforeEach(resetState);

it.each(['another owner', 'catalog reservation'])('keeps a replacement %s when a deletion was authorized for the previous record', async kind => {
  const link = await create();
  const key = recordKey(link.id);
  const original = await (await hubStorage.get(env.HUB_DB, key))!.json<Record<string, unknown>>();
  const replacement = kind === 'another owner'
    ? { ...original, ownerHash: await hash('B'.repeat(43)), fingerprint: 'b'.repeat(64) }
    : { schemaVersion: 1, kind: 'catalog', id: link.id, datasetId: 'data-' + 'a'.repeat(24), createdAt: original.createdAt };
  const erase = hubStorage.delete;
  vi.spyOn(hubStorage, 'delete').mockImplementationOnce(async (...args) => {
    // Another operation reuses the name after authorization but before the SQL delete.
    await hubStorage.put(env.HUB_DB, key, JSON.stringify(replacement));
    return erase(...args);
  });
  expect((await remove(link.id)).status).toBe(204);
  const current = await hubStorage.get(env.HUB_DB, key);
  expect(current).not.toBeNull();
  expect(await current!.json()).toEqual(replacement);
});

const publication = (id: string) => ({ ...input(), id, listed: true, schemaVersion: 1,
  ownerHash: 'a'.repeat(64), fingerprint: 'b'.repeat(64), createdAt: '2026-10-25T00:00:00Z',
  verification: { method: 'manual_review', checkedAt: '2026-10-25T00:00:00Z' } });

it('reserves an ID atomically and round-trips the binary preview without base64 in metadata', async () => {
  const key = 'links/HappyTree.json', first = JSON.stringify(input()), second = JSON.stringify(input({ title: 'Another owner' }));
  const reserved = await Promise.all([hubStorage.put(env.HUB_DB, key, first, { createOnly: true }),
    hubStorage.put(env.HUB_DB, key, second, { createOnly: true })]);
  expect(reserved.filter(Boolean)).toHaveLength(1);
  expect(await (await hubStorage.get(env.HUB_DB, key))!.json()).toEqual(JSON.parse(reserved[0] ? first : second));
  const row = await env.HUB_DB.prepare('SELECT body_json,typeof(preview_jpeg) AS kind,length(preview_jpeg) AS bytes FROM hub_entries').first();
  expect(row).toMatchObject({ kind: 'blob', bytes: atob(preview).length });
  expect(row!.body_json).not.toContain('thumbnailBase64');
  await hubStorage.delete(env.HUB_DB, key);
  expect(await hubStorage.get(env.HUB_DB, key)).toBeNull();
});

it('pages verified publications without reading preview blobs or scanning private and pending records', async () => {
  for (const [namespace, id] of [['links', 'HappyTree'], ['pending-publications', 'CalmStone-LAAAAAAAAAAAAAAAA'],
    ...['AaaTree', 'BbbTree', 'CccTree', 'DddTree', 'EeeTree'].map(name => ['listed', `${name}-LAAAAAAAAAAAAAAAA`])]) {
    await hubStorage.put(env.HUB_DB, `${namespace}/${id}.json`, JSON.stringify(publication(id)));
  }
  const get = vi.spyOn(hubStorage, 'get');
  const first = await sharedDatasets(env);
  expect(first.entries).toHaveLength(4);
  expect(JSON.stringify(first)).not.toMatch(/thumbnailBase64|ownerHash|fingerprint|HappyTree|CalmStone/);
  expect(get).not.toHaveBeenCalled();
  const second = await sharedDatasets(env, first.cursor);
  expect(second.entries.map(entry => entry.id)).toEqual(['EeeTree-LAAAAAAAAAAAAAAAA']);
  expect(second.cursor).toBeUndefined();
  const privateCursor = (await hubStorage.list(env.HUB_DB, { namespace: 'links', limit: 1 })).cursor;
  const wrongScope = btoa(JSON.stringify({ version: 1, namespace: 'links', id: privateCursor ?? 'HappyTree' }));
  await expect(sharedDatasets(env, wrongScope)).rejects.toThrow('Invalid page cursor');
});

it('promotes only the reviewed pending record and keeps conflicting publications intact', async () => {
  const id = 'HappyTree-LAAAAAAAAAAAAAAAA', key = `pending-publications/${id}.json`;
  await hubStorage.put(env.HUB_DB, key, JSON.stringify(publication(id)));
  const approved = reviewPublication(publication(id));
  await hubStorage.put(env.HUB_DB, `listed/${id}.json`, JSON.stringify({ ...approved, ownerHash: 'c'.repeat(64) }));
  await expect(approvePublication(env.HUB_DB, approved)).rejects.toThrow('different record');
  expect(await hubStorage.get(env.HUB_DB, key)).not.toBeNull();
  await hubStorage.delete(env.HUB_DB, `listed/${id}.json`);
  await approvePublication(env.HUB_DB, approved);
  expect(await hubStorage.get(env.HUB_DB, key)).toBeNull();
  expect(await (await hubStorage.get(env.HUB_DB, `listed/${id}.json`))!.json()).toEqual(approved);
  await expect(approvePublication(env.HUB_DB, approved)).resolves.toBeUndefined();
});

it('accepts compact and legacy preview dimensions while rejecting arbitrary sizes', () => {
  const bytes = Uint8Array.from(atob(preview), char => char.charCodeAt(0));
  expect(decodePreview(preview)).toEqual(bytes);
  let start = -1;
  for (let index = 2; index < bytes.length - 8; index++) {
    if (bytes[index] === 0xff && [0xc0, 0xc2].includes(bytes[index + 1])) { start = index; break; }
  }
  expect(start).toBeGreaterThan(0);
  bytes.set([0, 168, 1, 64], start + 5);
  const encoded = () => btoa(String.fromCharCode(...bytes));
  expect(decodePreview(encoded())).toEqual(bytes);
  bytes[start + 8] = 63;
  expect(() => decodePreview(encoded())).toThrow('320 × 168');
});
