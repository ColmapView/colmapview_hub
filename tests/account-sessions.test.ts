import { env } from 'cloudflare:workers';
import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import worker from '../src/worker/index';
import { randomValue, seal, sessionId, unseal } from '../src/worker/auth/crypto';
import { providerScopes } from '../src/worker/auth/providers';
import { accountValue, type AccountTokens } from '../src/worker/auth/model';

const origin = 'https://colmapview.opsiclear.com';
async function call(path: string, body?: object, cookie?: string, headers: HeadersInit = {}) {
  const merged = new Headers(headers);
  if (cookie) merged.set('Cookie', cookie);
  if (body) { merged.set('Origin', origin); merged.set('X-ColmapView-Session', '1'); merged.set('Content-Type', 'application/json'); }
  const ctx = createExecutionContext();
  const result = await worker.fetch(new Request(`${origin}/auth/${path}`, { method: body ? 'POST' : 'GET', headers: merged,
    ...(body ? { body: JSON.stringify(body) } : {}) }), env, ctx);
  await waitOnExecutionContext(ctx);
  return result;
}

const bucket = { remember: true, config: { baseUrl: 'https://s3.example/bucket/', region: 'auto' },
  credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' }, writable: false };
async function connectedBucket() {
  const result = await call('bucket/connect', bucket);
  expect(result.status, await result.clone().text()).toBe(200);
  const cookie = result.headers.get('Set-Cookie')!.split(';')[0];
  const id = await sessionId(new Request(origin, { headers: { Cookie: cookie } }), env.AUTH_KEY);
  expect(id).toBeTruthy();
  return { cookie, stub: env.ACCOUNT_SESSIONS.getByName(id!) };
}

async function seedTokens(stub: ReturnType<typeof env.ACCOUNT_SESSIONS.getByName>, tokens: AccountTokens, key = 'account:google:view') {
  await runInDurableObject(stub, async (_instance, state) => {
    const ciphertext = await seal(env.AUTH_KEY, `${state.id.toString()}:${key}:v1`, tokens);
    state.storage.sql.exec('INSERT OR REPLACE INTO account_records VALUES (?, ?, ?, ?)', key, randomValue(), ciphertext, Date.now() + 3600_000);
  });
}

describe('remembered account sessions', () => {
  it('checks capabilities without creating a cookie or making external requests', async () => {
    const result = await call('session');
    expect(result.status).toBe(200);
    expect(result.headers.has('Set-Cookie')).toBe(false);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(result.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(await result.json()).toMatchObject({ accounts: [], bucket: null, capabilities: { google: true, hf: true, bucket: true } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires same-origin JSON plus the CSRF header before accepting a credential', async () => {
    const variants: HeadersInit[] = [ {}, { Origin: origin, 'Content-Type': 'application/json' },
      { Origin: 'https://other.example', 'Content-Type': 'application/json', 'X-ColmapView-Session': '1' } ];
    for (const headers of variants) {
      const response = await worker.fetch(new Request(`${origin}/auth/bucket/connect`, { method: 'POST', headers, body: JSON.stringify(bucket) }), env, createExecutionContext());
      expect(response.status).toBe(403);
      expect(response.headers.has('Set-Cookie')).toBe(false);
    }
    expect((await call('bucket/connect', { ...bucket, remember: false })).status).toBe(400);
  });

  it('encrypts bucket credentials, protects the cookie and restores only nonsensitive connection settings', async () => {
    const response = await call('bucket/connect', bucket);
    const cookie = response.headers.get('Set-Cookie')!;
    expect(cookie).toContain('Secure; HttpOnly; SameSite=Lax');
    expect(cookie).not.toMatch(/fixture|s3.example/);
    const id = await sessionId(new Request(origin, { headers: { Cookie: cookie.split(';')[0] } }), env.AUTH_KEY);
    const stub = env.ACCOUNT_SESSIONS.getByName(id!);
    await runInDurableObject(stub, async (_instance, state) => {
      const row = state.storage.sql.exec<{ value: string }>('SELECT value FROM account_records WHERE key = ?', 'bucket').one();
      expect(row.value).not.toMatch(/fixture|s3.example/);
      expect(await unseal(env.AUTH_KEY, `${state.id.toString()}:bucket:v1`, row.value)).toEqual({ config: bucket.config, credentials: bucket.credentials, writable: false });
      await expect(unseal(env.AUTH_KEY, 'another-session:bucket:v1', row.value)).rejects.toThrow();
    });
    const restored = await call('session', undefined, cookie.split(';')[0]);
    expect(await restored.text()).not.toMatch(/fixture-access|fixture-secret/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('signs only permitted objects and operations without returning keys or fetching the bucket', async () => {
    const { cookie } = await connectedBucket();
    const good = await call('bucket/sign', { url: 'https://s3.example/bucket/sparse/cameras.bin', method: 'GET' }, cookie);
    expect(good.status).toBe(200);
    const body = await good.json<{ url: string }>();
    expect(new URL(body.url).searchParams.has('X-Amz-Signature')).toBe(true);
    expect(body.url).not.toContain('fixture-secret');
    for (const request of [
      { url: 'https://s3.example/other/file.bin', method: 'GET' },
      { url: 'https://other.example/bucket/file.bin', method: 'GET' },
      { url: 'https://s3.example/bucket/file.bin', method: 'PUT' },
      { url: 'https://s3.example/bucket/?policy', method: 'GET' },
      { url: 'https://s3.example/bucket/', method: 'DELETE' },
    ]) expect((await call('bucket/sign', request, cookie)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('binds access tokens to the authenticated browser and Drive account, without exposing refresh tokens', async () => {
    const { cookie, stub } = await connectedBucket();
    await seedTokens(stub, { subject: 'drive-account', accessToken: 'fixture-token', refreshToken: 'fixture-refresh', scope: providerScopes('google', 'view'), expiresAt: Date.now() + 3600_000 });
    expect((await call('google/token', { purpose: 'view' })).status).toBe(401);
    expect((await call('google/token', { purpose: 'view', accountId: 'other-account' }, cookie)).status).toBe(409);
    const result = await call('google/token', { purpose: 'view', accountId: 'drive-account' }, cookie);
    expect(result.status).toBe(200);
    const value = await result.text();
    expect(value).toContain('fixture-token'); expect(value).not.toContain('fixture-refresh');
    const second = await connectedBucket();
    expect((await call('google/token', { purpose: 'view' }, second.cookie)).status).toBe(401);
    expect((await call('google/token', {}, cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a'))).status).toBe(401);
  });

  it('enables object uploads explicitly while keeping bucket administration unavailable', async () => {
    const { cookie } = await connectedBucket();
    expect((await call('bucket/enable-uploads', {}, cookie)).status).toBe(404);
    expect((await call('bucket/enable-uploads', { confirm: true }, cookie)).status).toBe(200);
    for (const request of [
      { url: 'https://s3.example/bucket/scene/file.bin', method: 'PUT' },
      { url: 'https://s3.example/bucket/scene/file.bin?uploads=', method: 'POST' },
      { url: 'https://s3.example/bucket/scene/file.bin?uploadId=fixture&partNumber=1', method: 'PUT' },
      { url: 'https://s3.example/bucket/scene/file.bin?uploadId=fixture', method: 'DELETE' },
    ]) {
      const response = await call('bucket/sign', request, cookie);
      expect(response.status, await response.clone().text()).toBe(200);
      expect((await response.json<{ url: string }>()).url).toContain('X-Amz-Signature');
    }
    expect((await call('bucket/sign', { url: 'https://s3.example/bucket/?policy', method: 'PUT' }, cookie)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cancels only the matching OAuth attempt and preserves newer or previously connected accounts', async () => {
    const { cookie, stub } = await connectedBucket();
    await seedTokens(stub, { subject: 'existing-account', accessToken: 'existing-token', scope: providerScopes('google', 'view'), expiresAt: Date.now() + 3600_000 });
    const first = await (await call('google/connect', { returnTo: '/', mode: 'popup' }, cookie)).json<{ transactionId: string }>();
    const second = await (await call('google/connect', { returnTo: '/', mode: 'popup' }, cookie)).json<{ transactionId: string }>();
    expect((await call('google/cancel', { transactionId: first.transactionId }, cookie)).status).toBe(200);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(state.storage.sql.exec<{ version: string }>('SELECT version FROM account_records WHERE key = ?', 'transaction:google').one().version).toBe(second.transactionId);
    });
    expect((await call('google/token', {}, cookie)).status).toBe(200);
    await call('google/cancel', { transactionId: second.transactionId }, cookie);
    expect((await call(`google/callback?state=${second.transactionId}&code=late`, undefined, cookie)).status).toBe(400);
    expect((await call('google/token', {}, cookie)).status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('removes revoked refresh credentials and permits a fresh connection', async () => {
    const { cookie, stub } = await connectedBucket();
    await seedTokens(stub, { subject: 'drive-account', accessToken: 'expired-token', refreshToken: 'fixture-refresh', scope: providerScopes('google', 'view'), expiresAt: Date.now() - 1000 });
    vi.mocked(fetch).mockImplementation(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    expect((await call('google/token', {}, cookie)).status).toBe(401);
    expect(accountValue(await stub.summary()).accounts).toEqual([]);
    expect((await call('google/connect', { returnTo: '/', mode: 'popup' }, cookie)).status).toBe(200);
  });

  it('renews an early-rejected access token instead of returning the same cached credential', async () => {
    const { cookie, stub } = await connectedBucket();
    await seedTokens(stub, { subject: 'drive-account', accessToken: 'rejected-before-expiry', refreshToken: 'fixture-refresh',
      scope: providerScopes('google', 'view'), expiresAt: Date.now() + 3600_000 });
    vi.mocked(fetch).mockImplementation(async () => Response.json({ access_token: 'renewed-access', token_type: 'Bearer', expires_in: 3600 }));
    const response = await call('google/token', { refresh: true }, cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accessToken: 'renewed-access', accountId: 'drive-account' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('forgets a connection server-side and expires all records after the browser session lifetime', async () => {
    const { cookie, stub } = await connectedBucket();
    expect((await call('bucket/disconnect', {}, cookie)).status).toBe(200);
    expect((await call('bucket/sign', { url: 'https://s3.example/bucket/file', method: 'GET' }, cookie)).status).toBe(401);
    await stub.rememberBucket({ config: bucket.config, credentials: bucket.credentials, writable: false });
    await runInDurableObject(stub, async (instance, state) => {
      state.storage.sql.exec('UPDATE account_lifetime SET expires = ?', Date.now() - 1);
      await instance.alarm();
      expect(state.storage.sql.exec('SELECT * FROM account_records').toArray()).toHaveLength(0);
    });
    expect(await (await call('session', undefined, cookie)).json()).toMatchObject({ accounts: [], bucket: null });
  });

  it('starts PKCE OAuth with a single-use browser-bound transaction and rejects external return URLs', async () => {
    expect((await call('google/connect', { returnTo: 'https://other.example/', mode: 'redirect' })).status).toBe(400);
    const response = await call('google/connect', { returnTo: '/?drive=open', loginHint: '123456', mode: 'popup' });
    expect(response.status).toBe(200);
    const { url } = await response.json<{ url: string }>();
    const login = new URL(url);
    expect(login.origin).toBe('https://accounts.google.com');
    expect(login.searchParams.get('access_type')).toBe('offline');
    expect(login.searchParams.get('code_challenge_method')).toBe('S256');
    expect(login.searchParams.get('login_hint')).toBe('123456');
    expect(login.searchParams.get('scope')).not.toContain('drive.readonly');
    const state = login.searchParams.get('state');
    expect((await call(`google/callback?state=${state}&error=access_denied`)).status).toBe(400);
    const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
    const cancelled = await call(`google/callback?state=${state}&error=access_denied`, undefined, cookie);
    expect(cancelled.status).toBe(200);
    expect(cancelled.headers.get('Content-Security-Policy')).toContain("script-src 'nonce-");
    expect(await cancelled.text()).toContain('Sign-in was cancelled');
    expect((await call(`google/callback?state=${state}&error=access_denied`, undefined, cookie)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('coalesces token renewal and does not resurrect a connection disconnected during refresh', async () => {
    const { cookie, stub } = await connectedBucket();
    await seedTokens(stub, { subject: 'drive-account', accessToken: 'expired-token', refreshToken: 'fixture-refresh', scope: providerScopes('google', 'view'), expiresAt: Date.now() - 1000 });
    vi.mocked(fetch).mockImplementation(async () => {
      await scheduler.wait(100);
      return Response.json({ access_token: 'late-token', token_type: 'Bearer', expires_in: 3600, scope: providerScopes('google', 'view') });
    });
    const first = call('google/token', {}, cookie);
    const second = call('google/token', {}, cookie);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await call('google/disconnect', {}, cookie);
    expect((await first).status).toBe(401);
    expect((await second).status).toBe(401);
    expect(accountValue(await stub.summary()).accounts).toEqual([]);
  });
});
