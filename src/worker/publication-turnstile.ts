import { boundedBytes } from './publication-verification';
import { InputError, isObject } from './validation';

export const PUBLICATION_ACTION = 'hub-publication';
export const publicationEnabled = (env: Env) => env.HUB_PUBLICATIONS_ENABLED === 'true'
  && Boolean(env.HUB_TURNSTILE_SITE_KEY && env.HUB_TURNSTILE_SECRET);

/** Siteverify is mandatory. Tokens are single-use and never saved in a card or log. */
export async function verifyPublicationChallenge(request: Request, token: unknown, env: Env): Promise<void> {
  if (typeof token !== 'string' || !token || token.length > 2048) throw new InputError('Complete the bot check before sharing.', 400);
  const origin = request.headers.get('Origin');
  if (!origin) throw new InputError('This origin cannot publish datasets.', 403);
  if (!new URL(env.HUB_ORIGIN).hostname.match(/^(localhost|127\.0\.0\.1)$/) && /^[123]x0{10}/.test(env.HUB_TURNSTILE_SECRET ?? '')) {
    throw new InputError('Hub publication is not configured.', 503);
  }
  let result: unknown;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ secret: env.HUB_TURNSTILE_SECRET, response: token, remoteip: request.headers.get('CF-Connecting-IP') }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(); }
    result = JSON.parse(new TextDecoder().decode(await boundedBytes(response, 8192)));
  } catch { throw new InputError('The bot check is unavailable. Try again.', 503); }
  if (!isObject(result) || result.success !== true || result.hostname !== new URL(origin).hostname || result.action !== PUBLICATION_ACTION) {
    throw new InputError('The bot check expired or failed. Complete it again.', 403);
  }
}
