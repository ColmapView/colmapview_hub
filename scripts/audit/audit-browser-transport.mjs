/** Runs inside the deployed viewer's browser origin, with no account credentials. */
export async function auditBrowserBatch(items) {
  let index = 0;
  const output = [];
  const request = async (url, range) => {
    const response = await fetch(url, { headers: { Range: range }, credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const contentRange = response.headers.get('content-range');
    const reader = response.body?.getReader();
    let bytes = 0;
    if (reader) {
      try { while (bytes < 4096) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; } }
      finally { await reader.cancel(); }
    }
    return { status: response.status, contentRange, bytesRead: Math.min(bytes, 4096) };
  };
  const worker = async () => {
    for (;;) {
      const item = items[index++];
      if (!item) return;
      const result = { url: item.url, checkedAt: new Date().toISOString(), sources: item.sources };
      try {
        result.prefix = await request(item.url, 'bytes=0-4095');
        if (result.prefix.status !== 200 && result.prefix.status !== 206) {
          result.delivery = result.prefix.status === 401 || result.prefix.status === 403 ? 'access_denied'
            : result.prefix.status === 404 ? 'not_found' : result.prefix.status === 429 ? 'rate_limited' : 'http_error';
        } else {
          result.delivery = 'browser_readable';
          if (item.zip) {
            const size = Number(result.prefix.contentRange?.split('/').at(-1)) || item.sizeBytes;
            if (!size || result.prefix.status !== 206) result.delivery = 'range_unverified';
            else {
              const start = Math.max(0, size - 4096);
              result.tail = await request(item.url, `bytes=${start}-${size - 1}`);
              if (result.tail.status !== 206 || result.tail.contentRange !== `bytes ${start}-${size - 1}/${size}`) result.delivery = 'range_unverified';
            }
          }
        }
      } catch (error) {
        result.delivery = 'browser_request_failed';
        result.error = error.name === 'TimeoutError' ? 'Browser request timed out' : 'Browser fetch failed; connectivity, CORS, or host access may be responsible';
      }
      output.push(result);
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return output;
}
