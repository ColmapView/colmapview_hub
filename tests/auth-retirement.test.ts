import { env } from 'cloudflare:workers';
import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import worker from '../src/worker/index';

const origin = 'https://colmapview.opsiclear.com';

describe('retired credential service', () => {
  it('reports no capabilities and clears a legacy cookie without consulting stored records', async () => {
    const getByName = vi.fn(() => { throw new Error('Credential storage must never be opened'); });
    const legacyEnvironment = { ...env, AUTH_ENABLED: 'true', ACCOUNT_SESSIONS: { getByName } };
    const response = await worker.fetch(new Request(`${origin}/auth/session`, {
      headers: { Cookie: '__Host-colmapview_session=old-session.old-signature' },
    }), legacyEnvironment, createExecutionContext());
    expect(await response.json()).toEqual({ capabilities: { google: false, hf: false, bucket: false },
      accounts: [], bucket: null, expiresAt: 0 });
    expect(response.headers.get('Set-Cookie')).toBe('__Host-colmapview_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(getByName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not set a cookie for an anonymous capability check', async () => {
    const response = await worker.fetch(new Request(`${origin}/auth/session`), env, createExecutionContext());
    expect(response.status).toBe(200);
    expect(response.headers.has('Set-Cookie')).toBe(false);
  });

  it.each(['bucket/connect', 'bucket/sign', 'bucket/enable-uploads', 'google/connect', 'google/token',
    'hf/connect', 'hf/token', 'all/disconnect'])('rejects %s before reading any credential body', async path => {
    const request = new Request(`${origin}/auth/${path}`, { method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'X-ColmapView-Session': '1' },
      body: JSON.stringify({ secretAccessKey: 'fixture-never-read', refreshToken: 'fixture-never-read' }),
    });
    const response = await worker.fetch(request, env, createExecutionContext());
    expect(response.status).toBe(410);
    expect(request.bodyUsed).toBe(false);
    expect(await response.text()).not.toContain('fixture-never-read');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never exchanges or reflects a code sent to the retired callback', async () => {
    const response = await worker.fetch(new Request(`${origin}/auth/google/callback?code=fixture-never-read&state=old`), env, createExecutionContext());
    expect(response.status).toBe(410);
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(await response.text()).not.toContain('fixture-never-read');
    expect(fetch).not.toHaveBeenCalled();
  });
});
