import { env } from 'cloudflare:workers';
import { listDurableObjectIds, runInDurableObject } from 'cloudflare:test';
import { expect } from 'vitest';
import worker from '../src/worker/index';
import type { AssetSummary, CreateLinkInput, LinkAccess } from '../src/shared/model';
import { clientIdentity } from '../src/worker/crypto';
import { galleryKey, hubLocation } from '../src/worker/pages';
import { resetWordlistCache, WORDLIST_KEY } from '../src/worker/records';
import { preview } from './fixtures/preview';

export const origin = 'https://colmapview.opsiclear.com';
export const base = `${origin}/hub`;
export const ip = '192.0.2.1';
export const owner = 'A'.repeat(43);
export const words = {
  adjectives: ['happy', 'funny', 'calm', 'bright', 'brave', 'gentle', 'quiet', 'quick'],
  nouns: ['tree', 'ball', 'stone', 'cloud', 'river', 'flower', 'mountain', 'forest'],
};
export const assets: AssetSummary = { format: 'zip', imageFormat: 'jpeg', colmap: { files: 5, cameras: 83, points: 83749 },
  images: 83, masks: 82, splats: 1, viewerSettings: true, preview: false };
/** Turns gallery listings on for one request. */
export const listings: Partial<Env> = { HUB_LISTINGS_ENABLED: 'true' };
export interface LinkResult { id: string; url: string; managementPath: string }
/** What a viewer sends. Viewers before access-aware links omit `access`. */
export type LinkPayload = Omit<CreateLinkInput, 'access' | 'listed'> & { access?: LinkAccess; listed?: boolean };

export function input(overrides: Partial<LinkPayload> = {}): LinkPayload {
  return { viewerUrl: `${origin}/?url=https%3A%2F%2Fdata.example%2Fmanifest.json#camera=43`, title: 'Demo reconstruction',
    description: 'A small test scene.', thumbnailBase64: preview, managementSecret: owner, listed: false, publicAcknowledged: true, ...overrides };
}

/** The test env with some bindings replaced. A proxy, so it works whether or not binding properties are enumerable. */
function withOverrides(overrides: Partial<Env>): Env {
  if (!Object.keys(overrides).length) return env;
  return new Proxy(env, { get: (target, key) => (key in overrides ? overrides[key as keyof Env] : Reflect.get(target, key)) }) as Env;
}

/** Calls the Worker module directly, so a test can override bindings such as the listings flag. */
export function request(path: string, init: RequestInit = {}, clientIp = ip, overrides: Partial<Env> = {}): Promise<Response> {
  const hubOrigin = overrides.HUB_ORIGIN ?? env.HUB_ORIGIN;
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', clientIp);
  if (['POST', 'DELETE', 'OPTIONS'].includes(init.method ?? 'GET') && !headers.has('Origin')) headers.set('Origin', hubOrigin);
  return worker.fetch(new Request(`${hubOrigin}${env.HUB_PATH}${path}`, { ...init, headers }), withOverrides(overrides));
}

export function post(payload: object, clientIp = ip, overrides: Partial<Env> = {}): Promise<Response> {
  return request('/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, clientIp, overrides);
}

export async function create(payload: object = input(), clientIp = ip, overrides: Partial<Env> = {}): Promise<LinkResult> {
  const response = await post(payload, clientIp, overrides);
  expect(response.status, await response.clone().text()).toBe(201);
  return response.json<LinkResult>();
}

export function remove(id: string, secret = owner, clientIp = ip): Promise<Response> {
  return request(`/api/links/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${secret}` } }, clientIp);
}

export async function guard(clientIp = ip) { return env.LOOKUP_GUARDS.getByName(await clientIdentity(env.HUB_KEY, clientIp)); }

/** Clears this local fixture's cached gallery page, bucket and guards. The Workers test plugin keeps storage and the Cache API between tests. Never touches production. */
export async function resetState(): Promise<void> {
  await caches.default.delete(galleryKey(hubLocation(env)));
  for (const object of (await env.LINKS.list()).objects) await env.LINKS.delete(object.key);
  for (const id of await listDurableObjectIds(env.LOOKUP_GUARDS)) {
    await runInDurableObject(env.LOOKUP_GUARDS.get(id), async (_, state) => { await state.storage.deleteAll(); });
  }
  await env.LINKS.put(WORDLIST_KEY, JSON.stringify({ version: 1, ...words }));
  resetWordlistCache();
}
