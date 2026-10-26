import { beforeEach, describe, expect, it } from 'vitest';
import { create, input, mockViewerDocument, request, resetState } from './helpers';

beforeEach(async () => { await resetState(); mockViewerDocument(); });

const navigation = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' };
const viewerUrl = 'https://colmapview.opsiclear.com/?url=https://drive.google.com/file/d/drive-fixture/view#camera=43';

describe('direct share links', () => {
  it.each(['public', 'private'] as const)('opens a %s dataset directly, preserving its saved URL and view', async access => {
    const link = await create(input({ viewerUrl, access }));
    expect(link.shareUrl).toBe(`https://colmapview.opsiclear.com/s/${link.id}`);
    for (const [prefix, method] of [['', 'GET'], ['', 'HEAD'], ['/../s', 'GET'], ['/../s', 'HEAD']]) {
      const response = await request(`${prefix}/${link.id}?url=https://unrelated.example/`, { method, headers: navigation });
      expect(response.status).toBe(200);
      expect(response.headers.get('Location')).toBeNull();
      expect(response.headers.get('Referrer-Policy')).toBe('strict-origin');
      expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
      expect(response.headers.get('Content-Security-Policy')).toBeNull();
      expect(response.headers.get('X-Hub-Viewer-Document')).toBeNull();
      expect(response.headers.get('Cache-Control')).toBe('no-store, no-transform');
      expect(response.headers.get('Vary')).toBe('Sec-Fetch-Dest, Sec-Fetch-Mode');
      const body = await response.text();
      if (method === 'HEAD') expect(body).toBe('');
      else expect(body).toContain(JSON.stringify({ version: 1, viewerUrl }));
    }
  });

  it('resolves a differently cased short link without an intermediate card or canonical hop', async () => {
    const link = await create(input({ viewerUrl }));
    const response = await request(`/../s/${link.id.toLowerCase()}`, { headers: navigation });
    expect(response.status).toBe(200);
    expect(response.headers.get('Location')).toBeNull();
    expect(await response.text()).toContain(JSON.stringify({ version: 1, viewerUrl }));
  });

  it.each(['Sec-Fetch-Dest', 'Sec-Fetch-Mode'])('recognizes navigation from %s alone', async header => {
    const link = await create(input({ viewerUrl }));
    expect((await request(`/${link.id}`, { headers: { [header]: navigation[header as keyof typeof navigation] } })).status).toBe(200);
  });

  it('keeps social metadata, image previews and management independent of navigation redirects', async () => {
    const link = await create(input({ viewerUrl }));
    const metadata = await request(`/../s/${link.id}`);
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get('Vary')).toBe('Sec-Fetch-Dest, Sec-Fetch-Mode');
    const html = await metadata.text();
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain(`https://colmapview.opsiclear.com/s/${link.id}/preview.jpg`);
    expect((await request(`/../s/${link.id}/preview.jpg`, { headers: navigation })).headers.get('Content-Type')).toBe('image/jpeg');
    const manage = await request(`/manage/${link.id}`, { headers: navigation });
    expect(manage.status).toBe(200);
    expect(await manage.text()).toContain('id="delete-link"');
  });

  it('preserves the short namespace during canonicalization and keeps legacy addresses readable', async () => {
    const link = await create(input({ viewerUrl }));
    const canonical = await request(`/../s/${link.id.toLowerCase()}?from=chat`);
    expect(canonical.status).toBe(308);
    expect(canonical.headers.get('Location')).toBe(`${link.shareUrl}?from=chat`);
    expect((await request(`/../s/${link.id}/`)).headers.get('Location')).toBe(link.shareUrl);
    expect((await request(`/${link.id}`)).status).toBe(200);
    expect((await request(`/${link.id}/preview.jpg`)).status).toBe(200);
  });

  it('counts a missing name once across both namespaces and shares their cooldown', async () => {
    const link = await create(input({ viewerUrl }));
    expect((await request('/MissingOne')).status).toBe(404);
    expect((await request('/../s/missingone', { method: 'HEAD' })).status).toBe(404);
    expect((await request('/../s/MissingTwo/preview.jpg')).status).toBe(404);
    expect((await request(`/../s/${link.id}`, { headers: navigation })).status).toBe(200);
    expect((await request('/MissingThree')).status).toBe(429);
    expect((await request(`/../s/${link.id}`, { headers: navigation })).status).toBe(429);
    expect((await request(`/${link.id}`, { headers: navigation })).status).toBe(429);
  });

  it('rejects cross-site embeds and prefetches on short links before spending misses', async () => {
    const link = await create(input({ viewerUrl }));
    for (const id of ['MissingOne', 'MissingTwo', 'MissingThree', link.id]) {
      for (const headers of [
        new Headers({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'image' }),
        new Headers({ 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'document', 'Sec-Purpose': 'prefetch' }),
      ]) expect((await request(`/../s/${id}`, { headers })).status).toBe(404);
    }
    expect((await request(`/../s/${link.id}`, { headers: navigation })).status).toBe(200);
  });

  it('applies the existing miss cooldown before serving an otherwise valid dataset', async () => {
    const link = await create(input({ viewerUrl }));
    for (const [index, expected] of [404, 404, 429].entries()) {
      expect((await request(`/missing-${index}`, { headers: navigation })).status).toBe(expected);
    }
    const blocked = await request(`/${link.id}`, { headers: navigation });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Location')).toBeNull();
  });
});
