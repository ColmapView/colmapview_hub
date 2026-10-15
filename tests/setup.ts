import { afterEach, beforeEach, vi } from 'vitest';

// The Hub never fetches submitted URLs on the server; any outgoing request fails the test that made it.
beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request')); });
afterEach(() => { vi.restoreAllMocks(); });
