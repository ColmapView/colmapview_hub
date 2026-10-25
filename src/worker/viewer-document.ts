import type { HubLocation } from './pages';
import { isLoopbackOrigin } from './validation';

/** Internal response marker, removed before sending headers to a visitor. */
export const VIEWER_DOCUMENT_HEADER = 'X-Hub-Viewer-Document';
const PRODUCTION_VIEWER = 'https://colmapview-opsiclear.pages.dev';
const MAX_DOCUMENT_BYTES = 128 * 1024;

/** Read only the deployed app shell, never the stored dataset URL or visitor-supplied headers. */
export async function viewerDocument(env: Env, location: HubLocation, viewerUrl: string): Promise<Response> {
  const origin = new URL(env.HUB_VIEWER_ORIGIN);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || origin.origin !== PRODUCTION_VIEWER && !(location.local && isLoopbackOrigin(origin.origin))) {
    throw new Error('Invalid viewer document origin');
  }
  const upstream = await fetch(origin, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { Accept: 'text/html' } });
  if (upstream.status !== 200 || !upstream.headers.get('Content-Type')?.toLowerCase().startsWith('text/html') || !upstream.body) {
    await upstream.body?.cancel();
    throw new Error('Viewer document unavailable');
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  const parts: string[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_DOCUMENT_BYTES) throw new Error('Viewer document exceeds the reader bound');
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } finally { await reader.cancel(); reader.releaseLock(); }
  const template = parts.join('');
  if (!/<meta\s+name=["']colmapview-hub-launch["']\s+content=["']1["']\s*\/?>/i.test(template) || !/<\/head>/i.test(template)) {
    throw new Error('Deployed viewer does not support short-address launches');
  }
  const data = JSON.stringify({ version: 1, viewerUrl }).replace(/</g, '\\u003c');
  const body = template.replace(/<\/head>/i, `<script id="colmapview-hub-launch" type="application/json">${data}</script></head>`);
  // Modified HTML has no upstream length, encoding, validators or cookies. Keep the viewer's browser policies.
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Cloudflare-CDN-Cache-Control': 'no-store', Vary: 'Sec-Fetch-Dest, Sec-Fetch-Mode', [VIEWER_DOCUMENT_HEADER]: '1' });
  for (const name of ['Content-Security-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy',
    'Cross-Origin-Resource-Policy', 'Permissions-Policy']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('Referrer-Policy', upstream.headers.get('Referrer-Policy') ?? 'strict-origin');
  return new Response(body, { headers });
}
