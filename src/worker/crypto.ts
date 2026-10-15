export function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hash(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

/** The imported HMAC key, kept per isolate for the key string it came from. A key that fails to import is never kept. */
let hmacKey: { source: string; key: CryptoKey } | null = null;

async function importHmacKey(key: string): Promise<CryptoKey> {
  if (hmacKey?.source === key) return hmacKey.key;
  const bytes = Uint8Array.from(atob(key.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('Hub key must contain 32 random bytes');
  const imported = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  hmacKey = { source: key, key: imported };
  return imported;
}

export async function keyedHash(key: string, value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await importHmacKey(key), new TextEncoder().encode(value)));
}

/** The eight hextets of an IPv6 address, or null when the text is not one. */
function ipv6Groups(value: string): number[] | null {
  let text = value.toLowerCase();
  let tail: number[] = [];
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const octets = dotted.slice(2, 6).map(Number);
    if (octets.some(octet => octet > 255)) return null;
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    text = dotted[1].endsWith('::') ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string) => part ? part.split(':').map(group => /^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : Number.NaN) : [];
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const count = head.length + rest.length + tail.length;
  if ([...head, ...rest].some(Number.isNaN) || (halves.length === 1 ? count !== 8 : count > 7)) return null;
  return [...head, ...new Array<number>(8 - count).fill(0), ...rest, ...tail];
}

/** The network a guard counts together: an IPv4 address (also when IPv4-mapped) or an IPv6 /64 prefix. */
export function clientNetwork(ip: string): string {
  const value = ip.trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return value;
  const groups = ipv6Groups(value);
  if (!groups) return value;
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
  }
  return `${groups.slice(0, 4).map(group => group.toString(16)).join(':')}::/64`;
}

export async function clientIdentity(key: string, ip: string): Promise<string> {
  return hex(await keyedHash(key, `client:${clientNetwork(ip)}`));
}

export interface Wordlists { adjectives: string[]; nouns: string[] }

/** The name of a word pair, each word in title case. Creation writes it and letter-case lookups resolve to it. */
export function canonicalName(adjective: string, noun: string): string {
  const titleCase = (word: string) => word[0].toUpperCase() + word.slice(1);
  return `${titleCase(adjective)}${titleCase(noun)}`;
}

function wordPair(digest: Uint8Array, words: Wordlists): string {
  const adjective = words.adjectives[((digest[0] << 8) | digest[1]) % words.adjectives.length];
  const noun = words.nouns[((digest[2] << 8) | digest[3]) % words.nouns.length];
  return canonicalName(adjective, noun);
}

export async function deriveShortId(key: string, secret: string, words: Wordlists, attempt: number): Promise<string> {
  return wordPair(await keyedHash(key, `short-link:${secret}:${attempt}`), words);
}

/** Private and listed links: one name with a 96-bit suffix. Also the scheme of unlisted links made before word pairs, which keep resolving. */
export async function deriveLongId(key: string, secret: string, words: Wordlists, listed = false): Promise<string> {
  const digest = await keyedHash(key, `${listed ? 'listed-link' : 'link'}:${secret}`);
  return `${wordPair(digest, words)}-${listed ? 'L' : ''}${base64Url(digest.slice(4, 16))}`;
}

export function equalHashes(left: string, right: string): boolean {
  return /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) && equalSecrets(left, right);
}

/** Constant-time comparison of two secret strings. */
export function equalSecrets(left: string, right: string): boolean {
  const [a, b] = [new TextEncoder().encode(left), new TextEncoder().encode(right)];
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}
