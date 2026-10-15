import { SECRET_PATTERN, waitText } from '../shared/model';

const path = document.documentElement.dataset.hubPath ?? '';
// Not named `status`, which would shadow the DOM library's global `status`.
const statusLine = document.querySelector<HTMLElement>('#status');
const say = (text: string, focus = false) => {
  if (!statusLine) return;
  statusLine.textContent = text;
  if (focus) statusLine.focus();
};

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
  const player = document.querySelector<HTMLElement>('#player')!;
  player.classList.add('playing');
  player.replaceChildren(frame);
  frame.focus();
};

const deletion = document.querySelector<HTMLFormElement>('#delete-link');
if (deletion) {
  const button = deletion.querySelector<HTMLButtonElement>('button')!;
  const incomplete = 'This delete link is incomplete. Open the full link saved when the Hub link was created.';
  // Read the fragment every time: fragment-only navigation (opening the full link, or a corrected one, in the same tab) doesn't reload this script.
  const currentKey = () => location.hash.slice(1);
  const validKey = (key: string) => SECRET_PATTERN.test(key);
  let phase: 'idle' | 'busy' | 'done' = 'idle';
  /** Enables the button only for a complete key; returns whether it is complete. */
  const enableForKey = () => {
    button.disabled = !validKey(currentKey());
    return !button.disabled;
  };
  const syncKey = (changed: boolean) => {
    if (phase !== 'idle') return;
    const valid = enableForKey();
    // A status about an earlier key no longer applies once the key changes.
    if (!valid) say(incomplete);
    else if (changed) say('');
  };
  syncKey(false);
  addEventListener('hashchange', () => syncKey(true));
  deletion.addEventListener('submit', async event => {
    event.preventDefault();
    const owner = currentKey();
    if (phase !== 'idle' || !validKey(owner)) return;
    phase = 'busy';
    button.disabled = true;
    const id = location.pathname.split('/').at(-1)!;
    try {
      const response = await fetch(`${path}/api/links/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } });
      if (response.status === 204) {
        phase = 'done';
        history.replaceState(null, '', location.pathname);
        say('Hub link deleted.', true);
        return;
      }
      const minutes = Math.ceil(Number(response.headers.get('Retry-After') ?? 600) / 60);
      const wait = `${waitText(minutes)}.`;
      say(response.status === 429 ? `Too many missing links from your network. ${wait}`
        : response.status >= 500 ? 'ColmapView Hub is unavailable. Try again in a few minutes.'
        : "This delete link doesn't match the Hub link.", true);
    } catch { say("Couldn't reach ColmapView Hub.", true); }
    if (phase !== 'busy') return;
    phase = 'idle';
    enableForKey();
  });
}
