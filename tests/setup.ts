import { afterEach, beforeEach, vi } from 'vitest';

// Outbound reads must be explicit fixtures: trusted app shells, Turnstile and anonymous HF verification only.
beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request')); });
afterEach(() => { vi.restoreAllMocks(); });
