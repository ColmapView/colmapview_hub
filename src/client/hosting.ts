import { HUB_ORIGIN, type HubFrontend, type ViewerHost, viewerHost } from '../shared/viewer-host';

export const hubFrontend = (): HubFrontend | undefined =>
  document.documentElement.dataset.hubFrontend === 'github' ? 'github' : undefined;

export const catalogViewerHost = (): ViewerHost | undefined =>
  hubFrontend() === 'github' ? 'github' : viewerHost(new URLSearchParams(location.search));

/** Public reads only. Neither the query string nor user input can select this backend. */
export const hubApiBase = (): string => hubFrontend() === 'github'
  ? HUB_ORIGIN + '/hub' : document.documentElement.dataset.hubPath ?? '/hub';

export const canonicalHubOrigin = (): string => hubFrontend() === 'github' ? HUB_ORIGIN : location.origin;
