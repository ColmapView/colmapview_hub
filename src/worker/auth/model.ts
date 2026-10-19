export type AccountProvider = 'google' | 'hf';
export type AccountPurpose = 'view' | 'publish' | 'install';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const TRANSACTION_SECONDS = 10 * 60;
export const SESSION_COOKIE = '__Host-colmapview_session';
export const CALLBACK_TYPE = 'colmapview:account-session:v1';

export class AccountError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export type AccountReply<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
export async function accountReply<T>(operation: () => T | Promise<T>): Promise<AccountReply<T>> {
  try { return { ok: true, value: await operation() }; }
  catch (error) { return { ok: false, status: error instanceof AccountError ? error.status : 503,
    error: error instanceof AccountError ? error.message : 'Could not complete this connection. Try again.' }; }
}
export function accountValue<T>(reply: AccountReply<T>): T {
  if (!reply.ok) throw new AccountError(reply.status, reply.error);
  return reply.value;
}

export interface AccountTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
  subject: string;
  username?: string;
}

export interface AccountTransaction {
  provider: AccountProvider;
  purpose: AccountPurpose;
  state: string;
  verifier: string;
  nonce: string;
  returnTo: string;
  mode: 'popup' | 'redirect';
  loginHint?: string;
}

export interface RememberedBucket {
  config: { baseUrl: string; region: string; publicBaseUrl?: string };
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
  writable: boolean;
}

export function providerName(value: string): AccountProvider {
  if (value === 'google' || value === 'hf') return value;
  throw new AccountError(404, 'Connection not found.');
}

export function accountPurpose(provider: AccountProvider, value: unknown): AccountPurpose {
  if (value === 'view' || value === undefined) return 'view';
  if (provider === 'google' && value === 'install') return value;
  if (provider === 'hf' && value === 'publish') return value;
  throw new AccountError(400, 'Invalid connection purpose.');
}
