const path = document.documentElement.dataset.hubPath ?? '';
// Not named `status`: this file is a script, and the DOM library already declares a global `status`.
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
  const owner = location.hash.slice(1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(owner)) {
    button.disabled = true;
    say('This delete link is incomplete. Open the full link saved when the Hub link was created.');
  }
  deletion.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    const id = location.pathname.split('/').at(-1)!;
    try {
      const response = await fetch(`${path}/api/links/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${owner}` } });
      if (response.status === 204) {
        history.replaceState(null, '', location.pathname);
        say('Hub link deleted.', true);
        return;
      }
      const minutes = Math.ceil(Number(response.headers.get('Retry-After') ?? 600) / 60);
      const wait = `Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
      say(response.status === 429 ? `Too many missing links from your network. ${wait}`
        : response.status >= 500 ? 'ColmapView Hub is unavailable. Try again in a few minutes.'
        : "This delete link doesn't match the Hub link.", true);
    } catch { say("Couldn't reach ColmapView Hub.", true); }
    button.disabled = false;
  });
}
