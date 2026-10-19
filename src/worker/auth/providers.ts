import * as oauth from 'oauth4webapi';
import { AccountError, type AccountProvider, type AccountPurpose, type AccountTokens, type AccountTransaction, SESSION_SECONDS } from './model';

const GOOGLE_FILE = 'https://www.googleapis.com/auth/drive.file';
const GOOGLE_INSTALL = 'https://www.googleapis.com/auth/drive.install';

export function providerConfiguration(provider: AccountProvider, env: Env) {
  const google = provider === 'google';
  const clientId = google ? env.AUTH_GOOGLE_CLIENT_ID : env.AUTH_HF_CLIENT_ID;
  const secret = google ? env.AUTH_GOOGLE_CLIENT_SECRET : env.AUTH_HF_CLIENT_SECRET;
  if (!clientId || !secret) throw new AccountError(503, 'This remembered connection is unavailable.');
  const server: oauth.AuthorizationServer = google ? {
    issuer: 'https://accounts.google.com', authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_endpoint: 'https://oauth2.googleapis.com/token', jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo', id_token_signing_alg_values_supported: ['RS256'],
  } : {
    issuer: 'https://huggingface.co', authorization_endpoint: 'https://huggingface.co/oauth/authorize',
    token_endpoint: 'https://huggingface.co/oauth/token', jwks_uri: 'https://huggingface.co/oauth/jwks',
    userinfo_endpoint: 'https://huggingface.co/oauth/userinfo', id_token_signing_alg_values_supported: ['RS256'],
  };
  return { server, client: { client_id: clientId, id_token_signed_response_alg: 'RS256' } satisfies oauth.Client,
    authenticate: google ? oauth.ClientSecretPost(secret) : oauth.ClientSecretBasic(secret) };
}

export function providerScopes(provider: AccountProvider, purpose: AccountPurpose): string {
  if (provider === 'google') return `openid ${GOOGLE_FILE}${purpose === 'install' ? ` ${GOOGLE_INSTALL}` : ''}`;
  return `openid profile read-repos${purpose === 'publish' ? ' contribute-repos' : ''}`;
}

/** The auth service contacts fixed provider endpoints only; remote dataset/bucket URLs never enter fetch. */
const providerFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const allowed = new Set([
    'https://oauth2.googleapis.com/token', 'https://www.googleapis.com/oauth2/v3/certs',
    'https://huggingface.co/oauth/token', 'https://huggingface.co/oauth/jwks', 'https://huggingface.co/oauth/userinfo',
  ]);
  if (!allowed.has(url.href)) throw new AccountError(503, 'Unexpected authorization endpoint.');
  const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const response = await fetch(url, { ...init, signal, redirect: 'error' });
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) throw new AccountError(503, 'The authorization response is too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Response(bytes, { status: response.status, headers: response.headers });
};

const requestOptions = { [oauth.customFetch]: providerFetch };
const callbackUrl = (origin: string, provider: AccountProvider) => `${origin}/auth/${provider}/callback`;

export async function authorizationUrl(transaction: AccountTransaction, env: Env): Promise<string> {
  const { server, client } = providerConfiguration(transaction.provider, env);
  const url = new URL(server.authorization_endpoint!);
  url.search = new URLSearchParams({ client_id: client.client_id, response_type: 'code',
    redirect_uri: callbackUrl(env.HUB_ORIGIN, transaction.provider), scope: providerScopes(transaction.provider, transaction.purpose),
    state: transaction.state, nonce: transaction.nonce, code_challenge: await oauth.calculatePKCECodeChallenge(transaction.verifier), code_challenge_method: 'S256' }).toString();
  if (transaction.provider === 'google') {
    url.searchParams.set('access_type', 'offline');
    // Only an explicit new connection requests consent. Session restoration uses the saved refresh token.
    url.searchParams.set('prompt', 'consent');
    if (transaction.loginHint) url.searchParams.set('login_hint', transaction.loginHint);
  }
  return url.href;
}

function tokenRecord(result: oauth.TokenEndpointResponse, transaction: Pick<AccountTransaction, 'provider' | 'purpose'>, previous?: AccountTokens): AccountTokens {
  const scope = result.scope ?? previous?.scope;
  const required = providerScopes(transaction.provider, transaction.purpose).split(' ');
  if (!scope || required.some(value => !scope.split(' ').includes(value))) throw new AccountError(403, 'The requested file permission was not granted.');
  if (result.token_type.toLowerCase() !== 'bearer' || !Number.isFinite(result.expires_in) || result.expires_in! <= 5 || result.expires_in! > SESSION_SECONDS) {
    throw new AccountError(503, 'The provider returned an invalid access token.');
  }
  const subject = oauth.getValidatedIdTokenClaims(result)?.sub ?? previous?.subject;
  if (!subject || subject.length > 255 || (previous && previous.subject !== subject)) throw new AccountError(401, 'Reconnect the same provider account.');
  return { accessToken: result.access_token, refreshToken: result.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + result.expires_in! * 1000, scope, subject, ...(previous?.username ? { username: previous.username } : {}) };
}

export async function exchangeAccountCode(transaction: AccountTransaction, query: string, env: Env): Promise<AccountTokens> {
  const { server, client, authenticate } = providerConfiguration(transaction.provider, env);
  const parameters = oauth.validateAuthResponse(server, client, new URLSearchParams(query), transaction.state);
  const response = await oauth.authorizationCodeGrantRequest(server, client, authenticate, parameters,
    callbackUrl(env.HUB_ORIGIN, transaction.provider), transaction.verifier, requestOptions);
  const result = await oauth.processAuthorizationCodeResponse(server, client, response, { expectedNonce: transaction.nonce, requireIdToken: true });
  await oauth.validateApplicationLevelSignature(server, response, requestOptions);
  const tokens = tokenRecord(result, transaction);
  if (transaction.provider === 'google' && transaction.loginHint && tokens.subject !== transaction.loginHint) {
    throw new AccountError(403, 'Choose the Google account used to open this file in Drive.');
  }
  if (transaction.provider === 'hf') {
    const response = await oauth.userInfoRequest(server, client, tokens.accessToken, requestOptions);
    const profile = await oauth.processUserInfoResponse(server, client, tokens.subject, response);
    if (typeof profile.preferred_username !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,95}$/.test(profile.preferred_username)) {
      throw new AccountError(503, 'Hugging Face did not identify the connected account.');
    }
    tokens.username = profile.preferred_username;
  }
  return tokens;
}

export async function refreshAccount(provider: AccountProvider, purpose: AccountPurpose, previous: AccountTokens, env: Env): Promise<AccountTokens> {
  if (!previous.refreshToken) throw new AccountError(401, 'Reconnect this account to continue.');
  const { server, client, authenticate } = providerConfiguration(provider, env);
  try {
    const response = await oauth.refreshTokenGrantRequest(server, client, authenticate, previous.refreshToken, requestOptions);
    const result = await oauth.processRefreshTokenResponse(server, client, response);
    if (result.id_token) await oauth.validateApplicationLevelSignature(server, response, requestOptions);
    return tokenRecord(result, { provider, purpose }, previous);
  } catch (error) {
    if (error instanceof oauth.ResponseBodyError && ['invalid_grant', 'invalid_token'].includes(error.error)) throw new AccountError(401, 'Reconnect this account to continue.');
    throw error;
  }
}
