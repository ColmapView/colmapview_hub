/** One retry covers transient edge failures; validation and permanent errors stay visible. */
export async function catalogRequest(url: string, signal: AbortSignal): Promise<Response> {
  const options = { signal, credentials: 'omit' as const };
  const first = await fetch(url, options);
  if (![502, 503, 504].includes(first.status)) return first;
  await first.body?.cancel();
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 250);
    signal.addEventListener('abort', abort, { once: true });
  });
  return fetch(url, options);
}
