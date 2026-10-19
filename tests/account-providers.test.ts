import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { encode } from '../src/worker/auth/crypto';
import { exchangeAccountCode, providerScopes, refreshAccount } from '../src/worker/auth/providers';
import type { AccountProvider, AccountTokens, AccountTransaction } from '../src/worker/auth/model';

async function identityToken(provider: AccountProvider, nonce: string) {
  const key = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = { ...await crypto.subtle.exportKey('jwk', key.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
  const text = new TextEncoder();
  const payload = { iss: provider === 'google' ? 'https://accounts.google.com' : 'https://huggingface.co', sub: '123456789',
    aud: provider === 'google' ? env.AUTH_GOOGLE_CLIENT_ID : env.AUTH_HF_CLIENT_ID,
    iat: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 3600, nonce };
  const input = `${encode(text.encode(JSON.stringify({ alg: 'RS256', kid: 'fixture-key' })))}.${encode(text.encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, text.encode(input));
  return { jwt: `${input}.${encode(new Uint8Array(signature))}`, jwk };
}

function transaction(provider: AccountProvider): AccountTransaction {
  return { provider, purpose: 'view', state: 'fixture-state', verifier: 'fixture-verifier-12345678901234567890123456789', nonce: 'fixture-nonce',
    returnTo: '/', mode: 'popup', ...(provider === 'google' ? { loginHint: '123456789' } : {}) };
}

describe('provider authorization adapters', () => {
  for (const provider of ['google', 'hf'] as const) {
    it(`exchanges and verifies ${provider} identity without storing a personal profile`, async () => {
      const identity = await identityToken(provider, 'fixture-nonce');
      vi.mocked(fetch).mockImplementation(async input => {
        const url = String(input);
        if (url.endsWith('/token')) return Response.json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh',
          token_type: 'Bearer', expires_in: 3600, scope: providerScopes(provider, 'view'), id_token: identity.jwt });
        if (url.endsWith('/certs') || url.endsWith('/jwks')) return Response.json({ keys: [identity.jwk] });
        if (url.endsWith('/userinfo')) return Response.json({ sub: '123456789', preferred_username: 'fixture-owner', email: 'do-not-store@example.test', name: 'Do not store' });
        throw new Error('Unexpected outgoing request');
      });
      const tokens = await exchangeAccountCode(transaction(provider), '?state=fixture-state&code=fixture-code', env);
      expect(tokens).toMatchObject({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh', subject: '123456789' });
      if (provider === 'hf') expect(tokens.username).toBe('fixture-owner');
      expect(JSON.stringify(tokens)).not.toMatch(/do-not-store|Do not store|example.test/);
      const request = vi.mocked(fetch).mock.calls.find(([input]) => String(input).endsWith('/token'))!;
      const parameters = new URLSearchParams(String(request[1]?.body));
      expect(parameters.get('code_verifier')).toBe(transaction(provider).verifier);
      expect(parameters.get('redirect_uri')).toBe(`${env.HUB_ORIGIN}/auth/${provider}/callback`);
      expect(String(request[0])).not.toMatch(/fixture-code|fixture-secret/);
    });

    it(`rejects an invalid ${provider} nonce or signature before accepting credentials`, async () => {
      const identity = await identityToken(provider, 'different-nonce');
      vi.mocked(fetch).mockImplementation(async input => String(input).endsWith('/token')
        ? Response.json({ access_token: 'fixture-access', token_type: 'Bearer', expires_in: 3600, scope: providerScopes(provider, 'view'), id_token: identity.jwt })
        : Response.json({ keys: [identity.jwk] }));
      await expect(exchangeAccountCode(transaction(provider), '?state=fixture-state&code=fixture-code', env)).rejects.toThrow();
      const valid = await identityToken(provider, 'fixture-nonce');
      vi.mocked(fetch).mockImplementation(async input => String(input).endsWith('/token')
        ? Response.json({ access_token: 'fixture-access', token_type: 'Bearer', expires_in: 3600, scope: providerScopes(provider, 'view'), id_token: valid.jwt })
        : Response.json({ keys: [identity.jwk] }));
      await expect(exchangeAccountCode(transaction(provider), '?state=fixture-state&code=fixture-code', env)).rejects.toThrow();
    });

    it(`renews ${provider} tokens and keeps rotated refresh credentials on the server`, async () => {
      const previous: AccountTokens = { accessToken: 'old-access', refreshToken: 'old-refresh', subject: '123456789',
        scope: providerScopes(provider, 'view'), expiresAt: Date.now() - 1, ...(provider === 'hf' ? { username: 'fixture-owner' } : {}) };
      vi.mocked(fetch).mockImplementation(async () => Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600 }));
      const renewed = await refreshAccount(provider, 'view', previous, env);
      expect(renewed).toMatchObject({ accessToken: 'new-access', refreshToken: 'new-refresh', subject: previous.subject, scope: previous.scope });
      const parameters = new URLSearchParams(String(vi.mocked(fetch).mock.calls[0][1]?.body));
      expect(parameters.get('grant_type')).toBe('refresh_token');
      expect(parameters.get('refresh_token')).toBe('old-refresh');
      vi.mocked(fetch).mockImplementation(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
      await expect(refreshAccount(provider, 'view', previous, env)).rejects.toMatchObject({ status: 401 });
    });
  }
});
