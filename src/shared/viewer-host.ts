/** A navigation hint, never an arbitrary return URL or a stored user preference. */
export type ViewerHost = 'github';
export type HubFrontend = 'github';
export const HUB_ORIGIN = 'https://colmapview.opsiclear.com';
export const GITHUB_ORIGIN = 'https://colmapview.github.io';

export const viewerHost = (query: URLSearchParams): ViewerHost | undefined =>
  query.get('viewerHost') === 'github' ? 'github' : undefined;

export const viewerHome = (host?: ViewerHost): string => host === 'github' ? `${GITHUB_ORIGIN}/latest/` : `${HUB_ORIGIN}/`;

/** Keep the hint on Hub navigation, not source, preview, policy or API URLs. */
export function hubViewerLink(href: string, host?: ViewerHost, frontend?: HubFrontend): string {
  if (host !== 'github') return href;
  const url = new URL(href, HUB_ORIGIN);
  const catalog = /^\/hub\/datasets(?:\/|$)/.test(url.pathname)
    && !/^\/hub\/datasets\/(?:api|individual)\//.test(url.pathname);
  const share = /^\/s\/(?:[A-Za-z0-9_-]+|d\/[A-Za-z0-9_-]+)$/.test(url.pathname);
  if (url.origin !== HUB_ORIGIN || !catalog && !share) return href;
  url.searchParams.set('viewerHost', host);
  if (frontend === 'github') {
    if (share || /^\/hub\/datasets\/open\//.test(url.pathname)) return url.href;
    const entry = /^\/hub\/datasets\/entry\/(data-[a-f0-9]{24})$/.exec(url.pathname);
    if (entry) return `/hub/datasets/entry/?id=${entry[1]}`;
    const collection = /^\/hub\/datasets\/((?:hf|public)-[a-z0-9-]+-[a-f0-9]{12})$/.exec(url.pathname);
    if (collection) return `/hub/datasets/?dataset=${encodeURIComponent(collection[1])}`;
  }
  return href.startsWith('/') ? url.pathname + url.search + url.hash : url.href;
}

/** Public CDN assets stay on the backend; navigation stays on the selected frontend. */
export function hubAssetUrl(href: string, frontend?: HubFrontend): string {
  return frontend === 'github' && href.startsWith('/hub/') ? HUB_ORIGIN + href : href;
}

/** Only the two known viewers can be selected. Preserve exact dataset/query/hash state. */
export function preferredViewerUrl(href: string, host?: ViewerHost): string {
  if (host !== 'github') return href;
  const url = new URL(href, HUB_ORIGIN);
  if (url.origin !== HUB_ORIGIN || url.username || url.password || url.pathname !== '/') return href;
  const target = new URL(viewerHome(host));
  target.search = url.search; target.hash = url.hash;
  return target.href;
}
