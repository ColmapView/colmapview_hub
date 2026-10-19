import { env } from 'cloudflare:workers';
import { encode } from '../src/worker/auth/crypto';
import type { AccountProvider } from '../src/worker/auth/model';

export async function identityToken(provider: AccountProvider, nonce: string) {
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
