import { prepareThumbnail } from './thumbnail';
import type { CreateLinkInput } from '../shared/model';

interface Turnstile {
  render(element: HTMLElement, options: { sitekey: string; action: string }): string;
  getResponse(id: string): string;
  reset(id: string): void;
}
declare global { interface Window { turnstile?: Turnstile } }

const path = document.documentElement.dataset.hubPath ?? '';
const status = document.querySelector<HTMLElement>('#status');
const message = (value: string) => { if (status) status.textContent = value; };

function managementSecret(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function copy(value: string, label: string): Promise<void> {
  try { await navigator.clipboard.writeText(value); message(`${label} copied.`); }
  catch {
    const input = document.createElement('input');
    input.readOnly = true;
    input.value = value;
    input.setAttribute('aria-label', label);
    document.querySelector('#result')?.append(input);
    input.focus();
    input.select();
    message(`Select and copy the ${label.toLowerCase()}.`);
  }
}

async function loadVerification(): Promise<{ api: Turnstile; id: string }> {
  const key = document.documentElement.dataset.siteKey;
  if (!key) throw new Error('Link creation is not available yet.');
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Verification could not load. Please try again.'));
    document.head.append(script);
  });
  const api = window.turnstile;
  if (!api) throw new Error('Verification could not load.');
  return { api, id: api.render(document.querySelector<HTMLElement>('#verification')!, { sitekey: key, action: 'create-link' }) };
}

async function creationForm(form: HTMLFormElement): Promise<void> {
  let secret: string | null = null;
  let pending = false;
  let ready: { api: Turnstile; id: string } | null = null;
  let previewVersion = 0;
  let thumbnail: { file: File; promise: Promise<string> } | null = null;
  const thumbnailFor = (file: File) => {
    if (thumbnail?.file !== file) thumbnail = { file, promise: prepareThumbnail(file) };
    return thumbnail.promise;
  };
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  submit.disabled = true;
  form.addEventListener('input', () => { secret = null; });
  const fileInput = form.elements.namedItem('preview') as HTMLInputElement;
  fileInput.addEventListener('change', async () => {
    const version = ++previewVersion;
    const image = document.querySelector<HTMLImageElement>('#draft-preview')!;
    image.hidden = true;
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const prepared = await thumbnailFor(file);
      if (version === previewVersion) { image.src = `data:image/jpeg;base64,${prepared}`; image.hidden = false; }
    } catch (error) { if (version === previewVersion) message(error instanceof Error ? error.message : 'Unable to prepare this preview.'); }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    const turnstileToken = ready?.api.getResponse(ready.id);
    if (!turnstileToken) { message('Complete verification first.'); return; }
    const data = new FormData(form);
    const file = fileInput.files?.[0];
    if (!file) return;
    // Capture this draft's ownership key before asynchronous work. Later form
    // edits must never associate a saved record with a different management key.
    const owner = secret ??= managementSecret();
    pending = true;
    const controls = [...form.elements].filter((element): element is HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLButtonElement);
    controls.forEach(element => { element.disabled = true; });
    message('Creating link…');
    try {
      const licenseName = String(data.get('licenseName') ?? '').trim();
      const licenseUrl = String(data.get('licenseUrl') ?? '').trim();
      const input: CreateLinkInput = {
        viewerUrl: String(data.get('viewerUrl')), title: String(data.get('title')), description: String(data.get('description') ?? ''),
        thumbnailBase64: await thumbnailFor(file), managementSecret: owner, turnstileToken,
        publicAcknowledged: true,
        ...(licenseName || licenseUrl ? { license: { ...(licenseName ? { name: licenseName } : {}), ...(licenseUrl ? { url: licenseUrl } : {}) } } : {}),
      };
      const response = await fetch(`${path}/api/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
      const result: unknown = await response.json();
      if (typeof result !== 'object' || result === null) throw new Error('Unable to create a link.');
      if (!response.ok) throw new Error('error' in result && typeof result.error === 'string' ? result.error : 'Unable to create a link.');
      if (!('url' in result) || typeof result.url !== 'string' || !('managementPath' in result) || typeof result.managementPath !== 'string') throw new Error('Unable to create a link.');
      const publicUrl = result.url;
      const managementUrl = `${location.origin}${result.managementPath}#${owner}`;
      const link = document.querySelector<HTMLAnchorElement>('#public-link')!;
      link.href = publicUrl;
      link.textContent = publicUrl;
      document.querySelector<HTMLAnchorElement>('#open-link')!.href = publicUrl;
      document.querySelector<HTMLButtonElement>('#copy-link')!.onclick = () => { void copy(publicUrl, 'Link'); };
      document.querySelector<HTMLButtonElement>('#copy-management')!.onclick = () => { void copy(managementUrl, 'Management link'); };
      form.hidden = true;
      document.querySelector<HTMLElement>('#result')!.hidden = false;
      message('Link created.');
    } catch (error) {
      message(error instanceof Error ? error.message : 'Unable to create a link. Please try again.');
      if (ready) ready.api.reset(ready.id);
    } finally {
      pending = false;
      controls.forEach(element => { element.disabled = false; });
    }
  });
  document.querySelector<HTMLButtonElement>('#new-link')!.onclick = () => {
    secret = null;
    thumbnail = null;
    previewVersion++;
    form.reset();
    form.hidden = false;
    document.querySelector<HTMLElement>('#result')!.hidden = true;
    document.querySelector<HTMLImageElement>('#draft-preview')!.hidden = true;
    if (ready) ready.api.reset(ready.id);
    message('');
  };
  try { ready = await loadVerification(); submit.disabled = false; }
  catch (error) { message(error instanceof Error ? error.message : 'Verification could not load.'); }
}

const form = document.querySelector<HTMLFormElement>('#create-link');
if (form) void creationForm(form);

const play = document.querySelector<HTMLButtonElement>('#play');
if (play) play.onclick = () => {
  const url = new URL(play.dataset.viewerUrl!);
  url.searchParams.set('embed', '1');
  const frame = document.createElement('iframe');
  frame.src = url.href;
  frame.title = 'Interactive ColmapView viewer';
  frame.allowFullscreen = true;
  frame.setAttribute('allow', 'fullscreen');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads');
  document.querySelector('#player')!.replaceChildren(frame);
};

const deletion = document.querySelector<HTMLFormElement>('#delete-link');
if (deletion) deletion.addEventListener('submit', async event => {
  event.preventDefault();
  if (!deletion.reportValidity()) return;
  const owner = location.hash.slice(1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(owner)) { message('Open the private management link saved when this link was created.'); return; }
  const id = location.pathname.split('/').at(-1)!;
  const button = deletion.querySelector<HTMLButtonElement>('button')!;
  button.disabled = true;
  try {
    const response = await fetch(`${path}/api/links/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } });
    if (!response.ok) throw new Error(response.status === 429 ? 'Too many failed lookups. Try again later.' : 'Unable to delete this link. Check the management link.');
    history.replaceState(null, '', location.pathname);
    message('Link deleted.');
  } catch (error) { message(error instanceof Error ? error.message : 'Unable to delete this link.'); button.disabled = false; }
});
