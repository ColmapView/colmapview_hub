import { env } from 'cloudflare:workers';
import { beforeEach, expect, it, vi } from 'vitest';
import { create, input, mockViewerDocument, request, resetState } from './helpers';
import { viewerDocument } from '../src/worker/viewer-document';
import { hubLocation } from '../src/worker/pages';

const navigation = { 'Sec-Fetch-Dest': 'document', Cookie: 'private-cookie', Authorization: 'Bearer private-token' };
beforeEach(resetState);

it('escapes inert launch data and drops upstream validators, lengths and cookies', async () => {
  const fetch = mockViewerDocument();
  fetch.mockResolvedValue(new Response('<html><head><meta name="colmapview-hub-launch" content="1"></head><body></body></html>', {
    headers: { 'Content-Type': 'text/html', 'Content-Length': '123', ETag: '"old"', 'Set-Cookie': 'must-not-transfer=1',
      'Content-Security-Policy': "default-src 'self'", 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' },
  }));
  const target = 'https://colmapview.opsiclear.com/?url=</script><script>alert(1)</script>';
  const response = await viewerDocument(env, hubLocation(env), target);
  const body = await response.text();
  expect(body).not.toContain('</script><script>');
  const json = body.match(/type="application\/json">(.*?)<\/script>/)![1];
  expect(JSON.parse(json)).toEqual({ version: 1, viewerUrl: target });
  for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Set-Cookie']) expect(response.headers.get(name)).toBeNull();
  expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'self'");
  expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
});

it.each([
  [302, 'text/html', '<html></html>'],
  [200, 'application/json', '{}'],
  [200, 'text/html', '<html><head></head><body>Old viewer</body></html>'],
  [200, 'text/html', 'x'.repeat(128 * 1024 + 1)],
] as const)('fails at the short path instead of redirecting when the shell is invalid (%s %s)', async (status, contentType, body) => {
  const link = await create(input());
  mockViewerDocument().mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': contentType } }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const response = await request(`/../s/${link.id}`, { headers: navigation });
  expect(response.status).toBe(503);
  expect(response.headers.get('Location')).toBeNull();
  expect(await response.text()).not.toContain('data.example');
});

it('never forwards visitor credentials or fetches a submitted dataset address', async () => {
  const link = await create(input());
  const fetch = mockViewerDocument();
  expect((await request(`/../s/${link.id}`, { headers: navigation })).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [, init] = fetch.mock.calls[0];
  expect(init?.redirect).toBe('manual');
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(new Headers(init?.headers).get('Cookie')).toBeNull();
  expect(new Headers(init?.headers).get('Authorization')).toBeNull();
});

it('rejects loopback and arbitrary document origins on the production Hub', async () => {
  const link = await create(input());
  const fetch = mockViewerDocument();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  for (const origin of ['http://127.0.0.1:5173', 'https://untrusted.example', 'https://colmapview-opsiclear.pages.dev/path']) {
    const response = await request(`/../s/${link.id}`, { headers: navigation }, undefined, { HUB_VIEWER_ORIGIN: origin });
    expect(response.status).toBe(503);
  }
  expect(fetch).not.toHaveBeenCalled();
});

it('does not let a request header disable the Hub page policy', async () => {
  const response = await request('/', { headers: { 'X-Hub-Viewer-Document': '1' } });
  expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
});
