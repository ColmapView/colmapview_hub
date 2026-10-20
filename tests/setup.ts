import { afterEach, beforeEach, vi } from 'vitest';

// Outbound reads must be explicit fixtures: publication verification alone may contact Turnstile and trusted HF hosts.
beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request')); });
afterEach(() => { vi.restoreAllMocks(); });
