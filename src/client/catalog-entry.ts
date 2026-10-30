import { hubApiBase, hubFrontend } from './hosting';

const container = document.querySelector<HTMLElement>('#catalog-entry');
const status = document.querySelector<HTMLElement>('#catalog-entry-status');
const retry = document.querySelector<HTMLButtonElement>('#catalog-entry-retry');
if (hubFrontend() === 'github' && container && status && retry) {
  const id = new URLSearchParams(location.search).get('id') || '';
  let pending: AbortController | undefined;
  const load = async () => {
    if (!/^data-[a-f0-9]{24}$/.test(id)) { status.textContent = 'Dataset not found.'; return; }
    pending?.abort(); pending = new AbortController();
    status.hidden = false; status.textContent = 'Loading dataset…'; retry.hidden = true;
    try {
      // This namespace reads operator-built public catalog assets, never uploaded or unlisted shares.
      const response = await fetch(`${hubApiBase()}/datasets/api/entry/${id}`, { credentials: 'omit', signal: pending.signal });
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('text/html')) throw new Error();
      const html = await response.text();
      if (html.length > 2 * 1024 * 1024) throw new Error();
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      if (!parsed.querySelector(`.dataset-overview[data-entry-id="${id}"]`)
        || parsed.querySelector('script,style,iframe,object,embed,base,form,link,meta')) throw new Error();
      for (const element of parsed.body.querySelectorAll('*')) {
        if ([...element.attributes].some(attribute => /^on/i.test(attribute.name) || attribute.name === 'style')) throw new Error();
        for (const name of ['href', 'src']) {
          const value = element.getAttribute(name);
          if (value && !['https:', 'http:'].includes(new URL(value, location.href).protocol)) throw new Error();
        }
      }
      container.replaceChildren(...[...parsed.body.childNodes].map(node => document.importNode(node, true)));
      document.title = (container.querySelector('h1')?.textContent || 'Dataset') + ' · Spatial Hub';
      status.hidden = true;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      status.textContent = 'Dataset could not be loaded.'; retry.hidden = false;
    }
  };
  retry.onclick = () => { void load(); };
  addEventListener('pagehide', () => pending?.abort());
  void load();
}
