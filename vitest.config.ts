import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, miniflare: { bindings: {
    HUB_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    TURNSTILE_SECRET_KEY: 'unit-test-secret',
    TURNSTILE_SITE_KEY: 'unit-test-site-key',
  } } })],
  test: { include: ['tests/**/*.test.ts'] },
});
