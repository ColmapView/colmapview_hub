import { randomValue, sessionCookie, sessionId, signSession, validAccountKey } from './crypto';
import { AccountError, accountValue, CALLBACK_TYPE, accountPurpose, providerName, type AccountTransaction } from './model';
import { authorizationUrl, providerConfiguration } from './providers';
import { parseRememberedBucket } from './bucket';
import { escapeHtml } from '../../shared/html';

const json = (value: unknown, status = 200, headers?: HeadersInit) => Response.json(value, { status, headers });

function capabilities(env: Env) {
  const enabled = env.AUTH_ENABLED === 'true' && validAccountKey(env.AUTH_KEY);
  return { google: enabled && Boolean(env.AUTH_GOOGLE_CLIENT_ID && env.AUTH_GOOGLE_CLIENT_SECRET),
    hf: enabled && Boolean(env.AUTH_HF_CLIENT_ID && env.AUTH_HF_CLIENT_SECRET), bucket: enabled };
}

async function input(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json' || request.headers.has('Content-Encoding')) throw new AccountError(415, 'Use an unencoded JSON request.');
  if (Number(request.headers.get('Content-Length')) > 32768) throw new AccountError(413, 'The connection request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError(400, 'The connection request is empty.');
  let content = '';
  let bytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32768) throw new AccountError(413, 'The connection request is too large.');
      content += decoder.decode(value, { stream: true });
    }
    content += decoder.decode();
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountError(400, 'Invalid connection request.');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new AccountError(400, 'Invalid connection request.');
  } finally { await reader.cancel().catch(() => undefined); }
}

function returnPath(value: unknown, origin: string): string {
  if (typeof value !== 'string' || value.length > 16384) throw new AccountError(400, 'Invalid return address.');
  const url = new URL(value, origin);
  if (url.origin !== origin || url.username || url.password || !/^\/(?:dev\/|latest\/|v\d+\.\d+\.\d+\/)?$/.test(url.pathname)) throw new AccountError(400, 'Invalid return address.');
  for (const key of ['account_result', 'account_provider']) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

function callbackPage(origin: string, transaction: AccountTransaction, error?: string): Response {
  const target = new URL(transaction.returnTo, origin);
  target.searchParams.set('account_result', error ? 'cancelled' : 'connected');
  target.searchParams.set('account_provider', transaction.provider);
  if (transaction.mode === 'redirect') return new Response(null, { status: 303, headers: { Location: target.href } });
  const nonce = randomValue();
  const event = JSON.stringify({ type: CALLBACK_TYPE, provider: transaction.provider, transactionId: transaction.state, ...(error ? { error } : {}) }).replaceAll('<', '\\u003c');
  const script = `const result=${event};if(window.opener)window.opener.postMessage(result,${JSON.stringify(origin)});const channel=new BroadcastChannel('colmapview-account-'+result.transactionId);channel.postMessage(result);setTimeout(()=>{channel.close();window.close()},100);`;
  const title = error ? 'Connection not completed' : 'Connection ready';
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · ColmapView</title><link rel="stylesheet" href="/hub/colmapview.css"><main><h1>${title}</h1><p>${escapeHtml(error ?? 'You can return to ColmapView. This window will close automatically.')}</p><a href="${escapeHtml(target.href)}">Return to ColmapView</a></main><script nonce="${nonce}">${script}</script></html>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'` },
  });
}

function protect(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = env.HUB_ORIGIN;
  if (url.origin !== origin || url.search.length > 16384) throw new AccountError(404, 'Connection not found.');
  const available = capabilities(env);
  if (url.pathname === '/auth/session' && request.method === 'GET') {
    const id = validAccountKey(env.AUTH_KEY) ? await sessionId(request, env.AUTH_KEY) : null;
    return json({ capabilities: available, ...(id && env.AUTH_ENABLED === 'true'
      ? accountValue(await env.ACCOUNT_SESSIONS.getByName(id).summary()) : { accounts: [], bucket: null, expiresAt: 0 }) });
  }
  if (!available.bucket) throw new AccountError(503, 'Remembered connections are unavailable.');
  const callback = /^\/auth\/(google|hf)\/callback$/.exec(url.pathname);
  if (callback && request.method === 'GET') {
    const provider = providerName(callback[1]);
    if (!available[provider]) throw new AccountError(503, 'This connection is unavailable.');
    const id = await sessionId(request, env.AUTH_KEY);
    if (!id) throw new AccountError(400, 'Sign-in needs cookies for this site. Return to ColmapView and try again.');
    const result = accountValue(await env.ACCOUNT_SESSIONS.getByName(id).finish(provider, url.search));
    return callbackPage(origin, result.transaction, result.error);
  }
  // Cookies authenticate the browser. Origin plus a custom JSON header protect every mutation and token response.
  if (request.method !== 'POST') throw new AccountError(405, 'Use the connection controls in ColmapView.');
  if (request.headers.get('Origin') !== origin || request.headers.get('X-ColmapView-Session') !== '1'
    || (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) throw new AccountError(403, 'Open the connection controls on this site.');
  const body = await input(request);
  const existing = await sessionId(request, env.AUTH_KEY);
  const start = /^\/auth\/(google|hf)\/connect$/.exec(url.pathname);
  const remember = url.pathname === '/auth/bucket/connect';
  if (start || remember) {
    const id = existing ?? randomValue();
    const session = env.ACCOUNT_SESSIONS.getByName(id);
    // Validate before creating any stored state or cookie.
    const bucket = remember ? parseRememberedBucket(body) : null;
    const provider = start ? providerName(start[1]) : null;
    if (provider) {
      if (!available[provider]) throw new AccountError(503, 'This connection is unavailable.');
      providerConfiguration(provider, env);
    }
    const transaction: AccountTransaction | null = provider ? {
      provider, purpose: accountPurpose(provider, body.purpose), state: randomValue(), verifier: randomValue(), nonce: randomValue(),
      returnTo: returnPath(body.returnTo, origin), mode: body.mode === 'redirect' ? 'redirect' : 'popup',
      ...(provider === 'google' && typeof body.loginHint === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(body.loginHint) ? { loginHint: body.loginHint } : {}),
    } : null;
    const seconds = accountValue(await session.initialize());
    if (bucket) accountValue(await session.rememberBucket(bucket));
    else if (transaction) accountValue(await session.begin(transaction));
    return json(transaction ? { url: await authorizationUrl(transaction, env), transactionId: transaction.state } : { connected: true }, 200,
      { 'Set-Cookie': sessionCookie(await signSession(env.AUTH_KEY, id), seconds) });
  }
  if (!existing) throw new AccountError(401, 'Connect this account to continue.');
  const session = env.ACCOUNT_SESSIONS.getByName(existing);
  const cancel = /^\/auth\/(google|hf)\/cancel$/.exec(url.pathname);
  if (cancel) {
    if (typeof body.transactionId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.transactionId)) throw new AccountError(400, 'Invalid sign-in transaction.');
    accountValue(await session.cancel(providerName(cancel[1]), body.transactionId));
    return json({ cancelled: true });
  }
  const token = /^\/auth\/(google|hf)\/token$/.exec(url.pathname);
  if (token) {
    const provider = providerName(token[1]);
    if (!available[provider]) throw new AccountError(503, 'This connection is unavailable.');
    const expected = typeof body.accountId === 'string' && /^[A-Za-z0-9_-]{1,255}$/.test(body.accountId) ? body.accountId : undefined;
    return json(accountValue(await session.token(provider, accountPurpose(provider, body.purpose), expected, body.refresh === true)));
  }
  if (url.pathname === '/auth/bucket/sign') return json(accountValue(await session.signBucket(body)));
  if (url.pathname === '/auth/bucket/enable-uploads' && body.confirm === true) {
    accountValue(await session.enableBucketUploads());
    return json({ enabled: true });
  }
  const disconnect = /^\/auth\/(google|hf|bucket|all)\/disconnect$/.exec(url.pathname);
  if (disconnect) {
    const target = disconnect[1] === 'all' || disconnect[1] === 'bucket' ? disconnect[1] : providerName(disconnect[1]);
    accountValue(await session.disconnect(target));
    return json({ disconnected: true }, 200, target === 'all' ? { 'Set-Cookie': sessionCookie('', 0) } : undefined);
  }
  throw new AccountError(404, 'Connection not found.');
}

export async function accountRoute(request: Request, env: Env): Promise<Response> {
  let response: Response;
  try { response = await route(request, env); }
  catch (error) {
    // Provider responses and URLs can contain credentials. Never log authentication exceptions.
    response = json({ error: error instanceof AccountError ? error.message : 'Could not complete this connection. Try again.',
      status: error instanceof AccountError ? error.status : 503 }, error instanceof AccountError ? error.status : 503);
  }
  return protect(request, response);
}
