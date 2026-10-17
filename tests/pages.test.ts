import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assets, base, create, input, ip, listings, request, resetState } from './helpers';

beforeEach(resetState);

describe('Hub pages', () => {
  it('shows the description, nonzero asset counts and the linked license, and uses the description for social cards', async () => {
    const link = await create(input({ assets: { ...assets, masks: 0 }, license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' } }));
    const html = await (await request(`/${link.id}`)).text();
    expect(html).toContain('<p class="lede">A small test scene.</p>');
    expect(html).toContain('<p class="meta">83 images · 83,749 points · 1 splat · License: <a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">CC BY 4.0</a></p>');
    expect(html).toContain('<meta name="twitter:description" content="A small test scene.">');
    expect(html).toContain('id="play"');
  });

  it('uses the asset line as the social description when there is none', async () => {
    const link = await create(input({ description: '', assets }));
    expect(await (await request(`/${link.id}`)).text()).toContain('<meta name="twitter:description" content="83 images · 83,749 points · 82 masks · 1 splat">');
  });

  it('shows a private card with a viewer link instead of Play 3D', async () => {
    const link = await create(input({ access: 'private' }));
    const html = await (await request(`/${link.id}`)).text();
    expect(html).not.toContain('id="play"');
    expect(html).toContain('<p class="note">Viewers need access to open this dataset.</p>');
    expect(html).toContain('Open in ColmapView<span aria-hidden="true"> ↗</span>');
  });

  it('wraps pages in the ColmapView frame and stylesheets', async () => {
    const link = await create(input());
    for (const path of [`/${link.id}`, '/missing-frame']) {
      const html = await (await request(path)).text();
      expect(html).toContain('<a class="brand" href="/hub/">ColmapView <span>Hub</span></a>');
      expect(html).toContain('<a href="/hub/datasets/">Datasets</a>');
      for (const [href, label] of [['/', 'Open viewer'], ['/about.html', 'About'], ['/privacy.html', 'Privacy'], ['/terms.html', 'Terms']]) {
        expect(html).toContain(`<a href="https://colmapview.opsiclear.com${href}">${label}</a>`);
      }
      expect(html).toContain('<p>ColmapView · Maintained by OpsiClear LLC</p>');
      expect(html).toContain('<a href="mailto:info@opsiclear.com">Contact</a>');
      expect(html).toContain('<p class="eyebrow">ColmapView Hub</p>');
      expect(html.indexOf('/hub/colmapview.css')).toBeLessThan(html.indexOf('/hub/styles.css'));
      expect(html).toContain('/hub/assets/theme.js?v=scene-ui-7');
      expect(html).toContain('aria-label="Appearance"');
      expect(html).toContain('<link rel="icon" href="/hub/favicon.ico">');
      expect(html).toMatch(/<title>[^<]+ · ColmapView Hub<\/title>/);
    }
  });

  it('reads the record for the manage page and counts a missing one like a card lookup', async () => {
    const link = await create(input());
    const html = await (await request(`/manage/${link.id}`)).text();
    expect(html).toContain('<h1>Delete Hub link “Demo reconstruction”?</h1>');
    expect(html).toContain('<p class="lede">The dataset stays where it is.</p>');
    expect(html).toContain(`<img class="thumbnail" src="${base}/${link.id}/preview.jpg" width="600" height="315" alt="">`);
    expect(html).toContain('<button type="submit" class="button button-danger">Delete permanently</button>');
    expect(html).not.toContain('type="checkbox"');
    expect((await request('/manage/MissingOne')).status).toBe(404);
    expect((await request('/manage/MissingTwo')).status).toBe(404);
    expect((await request('/manage/MissingThree')).status).toBe(429);
  });

  it('escapes titles with markup and quotes in headings and the page title', async () => {
    const title = '"><script>alert(1)</script> “quoted”';
    const escaped = '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; “quoted”';
    const link = await create(input({ title }));
    for (const path of [`/${link.id}`, `/manage/${link.id}`]) {
      const html = await (await request(path)).text();
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain(escaped);
    }
    expect(await (await request(`/${link.id}`)).text()).toContain(`<title>${escaped} · ColmapView Hub</title>`);
  });

  it('allows fonts from the Hub itself', async () => {
    expect((await request('/missing-font')).headers.get('Content-Security-Policy')).toContain("font-src 'self'");
  });

  it('gives gallery images empty alt text, because the card text names the link', async () => {
    const link = await create(input({ listed: true, title: 'Listed result' }), ip, listings);
    const html = await (await request('/', {}, ip, listings)).text();
    expect(html).toContain(`<img src="/hub/${link.id}/preview.jpg" width="600" height="315" loading="lazy" alt="">`);
    expect(html).not.toContain('alt="Listed result"');
  });

  it('keeps pagination when a whole page of listings is skipped as invalid', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // These keys sort before every test word pair, so they fill the first page.
    for (let index = 0; index < 12; index++) {
      await env.LINKS.put(`listed/Aaa${String(index).padStart(2, '0')}.json`, '{}', { customMetadata: { title: '', createdAt: 'never' } });
    }
    const valid = await create(input({ listed: true, title: 'Listed result' }), ip, listings);
    const first = await (await request('/', {}, ip, listings)).text();
    expect(first).not.toContain(valid.id);
    expect(first).not.toContain('No results listed yet.');
    const next = /href="\/hub\/\?cursor=([^"]+)"/.exec(first);
    expect(next).not.toBeNull();
    expect(await (await request(`/?cursor=${next![1]}`, {}, ip, listings)).text()).toContain(valid.id);
  });
});
