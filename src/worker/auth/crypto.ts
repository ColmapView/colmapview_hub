import { AccountError, SESSION_COOKIE, SESSION_SECONDS } from './model';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
export const randomValue = () => encode(crypto.getRandomValues(new Uint8Array(32)));

export function validAccountKey(value?: string): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value));
}

async function key(secret: string | undefined, purpose: string, usage: 'encrypt' | 'decrypt' | 'sign' | 'verify'): Promise<CryptoKey> {
  if (!validAccountKey(secret)) throw new AccountError(503, 'Remembered connections are unavailable.');
  const material = await crypto.subtle.importKey('raw', decode(secret), 'HKDF', false, ['deriveKey']);
  const algorithm = usage === 'sign' || usage === 'verify' ? { name: 'HMAC', hash: 'SHA-256', length: 256 } : { name: 'AES-GCM', length: 256 };
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('colmapview-account-v1'), info: encoder.encode(purpose) }, material, algorithm, false, [usage]);
}

/** Records are encrypted with a separate purpose and bound to their DO and record key. */
export async function seal(secret: string | undefined, context: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    await key(secret, 'records', 'encrypt'), encoder.encode(JSON.stringify(value)));
  return `${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function unseal<T>(secret: string | undefined, context: string, value: string): Promise<T> {
  const [iv, ciphertext, extra] = value.split('.');
  if (!iv || !ciphertext || extra) throw new AccountError(401, 'Reconnect this account.');
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: encoder.encode(context) },
      await key(secret, 'records', 'decrypt'), decode(ciphertext));
    // Only authenticated, versioned server records reach this JSON boundary.
    return JSON.parse(decoder.decode(plain)) as T;
  } catch { throw new AccountError(401, 'Reconnect this account.'); }
}

export async function signSession(secret: string | undefined, id: string): Promise<string> {
  return `${id}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret, 'cookies', 'sign'), encoder.encode(id))))}`;
}

export async function sessionId(request: Request, secret: string | undefined): Promise<string | null> {
  const matches = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  const [id, signature, extra] = matches[0].slice(SESSION_COOKIE.length + 1).split('.');
  if (extra || !/^[A-Za-z0-9_-]{43}$/.test(id ?? '') || !/^[A-Za-z0-9_-]{43}$/.test(signature ?? '')) return null;
  try {
    if (encode(decode(signature)) !== signature || encode(decode(id)) !== id) return null;
    return await crypto.subtle.verify('HMAC', await key(secret, 'cookies', 'verify'), decode(signature), encoder.encode(id)) ? id : null;
  } catch { return null; }
}

export function sessionCookie(value: string, seconds = SESSION_SECONDS): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(seconds))}; Secure; HttpOnly; SameSite=Lax`;
}
