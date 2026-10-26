import { afterEach, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';

await applyD1Migrations(env.HUB_DB, (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS);

// Outbound reads must be explicit fixtures: trusted app shells, Turnstile and anonymous HF verification only.
beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request')); });
afterEach(() => { vi.restoreAllMocks(); });
