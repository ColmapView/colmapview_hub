import { afterEach, expect, it, vi } from 'vitest';
import { catalogRequest } from '../src/client/catalog-request';

afterEach(() => vi.restoreAllMocks());

it('retries one transient server failure with the same query and no credentials', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('temporary', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ page: 21 }));
  const signal = new AbortController().signal;
  const response = await catalogRequest('https://example.org/?page=21&seed=12345678', signal);
  expect(await response.json()).toEqual({ page: 21 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
  expect(fetcher.mock.calls[0][1]).toEqual({ signal, credentials: 'omit' });
});

it('does not loop on repeated server failures or retry a permanent error', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 503 }));
  expect((await catalogRequest('https://example.org/', new AbortController().signal)).status).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockClear(); fetcher.mockResolvedValue(new Response(null, { status: 400 }));
  expect((await catalogRequest('https://example.org/', new AbortController().signal)).status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('cancels the retry when navigation aborts during the backoff', async () => {
  const controller = new AbortController();
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
  const pending = catalogRequest('https://example.org/', controller.signal);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
