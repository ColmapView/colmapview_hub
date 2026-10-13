const path = document.documentElement.dataset.hubPath ?? '';
const message = (value: string) => {
  const status = document.querySelector<HTMLElement>('#status');
  if (status) status.textContent = value;
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
