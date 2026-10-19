import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' }, miniflare: { bindings: {
    HUB_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    AUTH_ENABLED: 'true',
    AUTH_KEY: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    AUTH_GOOGLE_CLIENT_ID: '123-session-fixture.apps.googleusercontent.com',
    AUTH_GOOGLE_CLIENT_SECRET: 'google-fixture-secret',
    AUTH_HF_CLIENT_ID: 'hf-session-fixture',
    AUTH_HF_CLIENT_SECRET: 'hf-fixture-secret',
  } } })],
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
