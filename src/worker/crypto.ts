export function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hash(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

export async function keyedHash(key: string, value: string): Promise<Uint8Array> {
  const bytes = Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('Hub key must contain 32 random bytes');
  const imported = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(value)));
}

export async function clientIdentity(key: string, ip: string): Promise<string> {
  return hex(await keyedHash(key, `client:${ip}`));
}

export async function deriveId(key: string, secret: string, words: { adjectives: string[]; nouns: string[] }): Promise<string> {
  const digest = await keyedHash(key, `link:${secret}`);
  const adjective = words.adjectives[((digest[0] << 8) | digest[1]) % words.adjectives.length];
  const noun = words.nouns[((digest[2] << 8) | digest[3]) % words.nouns.length];
  const titleCase = (word: string) => word[0].toUpperCase() + word.slice(1);
  // The suffix has 96 independent bits even if every dictionary word becomes known.
  return `${titleCase(adjective)}${titleCase(noun)}-${base64Url(digest.slice(4, 16))}`;
}

export function equalHashes(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  const bytes = (value: string) => Uint8Array.from(value.match(/../g)!, pair => Number.parseInt(pair, 16));
  return crypto.subtle.timingSafeEqual(bytes(left), bytes(right));
}
