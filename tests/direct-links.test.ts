import { beforeEach, describe, expect, it } from 'vitest';
import { create, input, request, resetState } from './helpers';

beforeEach(resetState);

const navigation = { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate' };
const viewerUrl = 'https://colmapview.opsiclear.com/?url=https://drive.google.com/file/d/drive-fixture/view#camera=43';

describe('direct share links', () => {
  it.each(['public', 'private'] as const)('opens a %s dataset directly, preserving its saved URL and view', async access => {
    const link = await create(input({ viewerUrl, access }));
    for (const method of ['GET', 'HEAD']) {
      const response = await request(`/${link.id}?url=https://unrelated.example/`, { method, headers: navigation });
      expect(response.status).toBe(307);
      expect(response.headers.get('Location')).toBe(viewerUrl);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Vary')).toBe('Sec-Fetch-Dest, Sec-Fetch-Mode');
      expect(await response.text()).toBe('');
    }
  });

  it('resolves a differently cased short link without an intermediate card or canonical hop', async () => {
    const link = await create(input({ viewerUrl }));
    const response = await request(`/${link.id.toLowerCase()}`, { headers: navigation });
    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe(viewerUrl);
  });

  it.each(['Sec-Fetch-Dest', 'Sec-Fetch-Mode'])('recognizes navigation from %s alone', async header => {
    const link = await create(input({ viewerUrl }));
    expect((await request(`/${link.id}`, { headers: { [header]: navigation[header as keyof typeof navigation] } })).status).toBe(307);
  });

  it('keeps social metadata, image previews and management independent of navigation redirects', async () => {
    const link = await create(input({ viewerUrl }));
    const metadata = await request(`/${link.id}`);
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get('Vary')).toBe('Sec-Fetch-Dest, Sec-Fetch-Mode');
    expect(await metadata.text()).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect((await request(`/${link.id}/preview.jpg`, { headers: navigation })).headers.get('Content-Type')).toBe('image/jpeg');
    const manage = await request(`/manage/${link.id}`, { headers: navigation });
    expect(manage.status).toBe(200);
    expect(await manage.text()).toContain('id="delete-link"');
  });

  it('applies the existing miss cooldown before redirecting an otherwise valid dataset', async () => {
    const link = await create(input({ viewerUrl }));
    for (const [index, expected] of [404, 404, 429].entries()) {
      expect((await request(`/missing-${index}`, { headers: navigation })).status).toBe(expected);
    }
    const blocked = await request(`/${link.id}`, { headers: navigation });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Location')).toBeNull();
  });
});
