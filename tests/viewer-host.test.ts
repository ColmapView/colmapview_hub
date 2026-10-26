import { expect, it } from 'vitest';
import { hubAssetUrl, hubViewerLink, preferredViewerUrl, viewerHome, viewerHost } from '../src/shared/viewer-host';

it('keeps GitHub gallery navigation local and backend launches and assets on the fixed backend', () => {
  const id = 'data-' + 'a'.repeat(24);
  expect(hubViewerLink(`/hub/entry/${id}`, 'github', 'github')).toBe(`/hub/entry/?id=${id}`);
  expect(hubViewerLink('/hub/?q=scene', 'github', 'github')).toBe('/hub/?q=scene&viewerHost=github');
  expect(hubViewerLink('/s/HappyTree', 'github', 'github')).toBe('https://colmapview.opsiclear.com/s/HappyTree?viewerHost=github');
  expect(hubViewerLink(`/hub/open/${id}`, 'github', 'github')).toBe(`https://colmapview.opsiclear.com/hub/open/${id}?viewerHost=github`);
  expect(hubAssetUrl('/hub/assets/client.js', 'github')).toBe('https://colmapview.opsiclear.com/hub/assets/client.js');
  expect(hubAssetUrl('/hub/assets/client.js')).toBe('/hub/assets/client.js');
});

it('accepts only the explicit fixed GitHub destination', () => {
  expect(viewerHost(new URLSearchParams('viewerHost=github'))).toBe('github');
  for (const value of ['', 'custom', 'Github', 'https://evil.example', 'github.evil.example']) {
    expect(viewerHost(new URLSearchParams({ viewerHost: value }))).toBeUndefined();
  }
  expect(viewerHome('github')).toBe('https://colmapview.github.io/latest/');
  expect(viewerHome()).toBe('https://colmapview.opsiclear.com/');
});

it('keeps search, pagination, metadata and share context without rewriting source or asset links', () => {
  for (const href of ['/hub/', '/hub/?q=scene&page=2#main',
    '/hub/entry/data-' + 'a'.repeat(24), '/hub/open/data-' + 'a'.repeat(24), '/s/HappyTree']) {
    expect(hubViewerLink(href)).toBe(href);
    const target = new URL(hubViewerLink(href, 'github'), 'https://colmapview.opsiclear.com');
    expect(target.searchParams.get('viewerHost')).toBe('github');
    expect(target.pathname).toBe(new URL(href, target).pathname);
    expect(target.hash).toBe(new URL(href, target).hash);
  }
  for (const href of ['https://huggingface.co/datasets/owner/data', '//evil.example/s/HappyTree',
    '/hub/datasets/individual/manifests/model.json', '/hub/datasets/api/entries',
    '/s/HappyTree/preview.jpg', '/privacy.html']) expect(hubViewerLink(href, 'github')).toBe(href);
});

it('switches viewer origin while preserving exact dataset selection and saved-view state', () => {
  const query = '?url=https%3A%2F%2Fdata.example%2Fmanifest.json%3Fpart%3D1&splats=none#camera=43';
  expect(preferredViewerUrl('https://colmapview.opsiclear.com/' + query, 'github')).toBe('https://colmapview.github.io/latest/' + query);
  const pinned = 'https://colmapview.github.io/v0.25.3/' + query;
  expect(preferredViewerUrl(pinned, 'github')).toBe(pinned);
  for (const href of ['https://colmapview.opsiclear.com/' + query, '/s/HappyTree']) expect(preferredViewerUrl(href)).toBe(href);
  for (const href of ['/s/HappyTree', 'https://evil.example/?url=data', 'https://colmapview.opsiclear.com.evil.example/?url=data',
    'https://user:pw@colmapview.opsiclear.com/?url=data']) expect(preferredViewerUrl(href, 'github')).toBe(href);
});
