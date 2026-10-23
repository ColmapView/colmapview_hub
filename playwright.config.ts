import { defineConfig } from '@playwright/test';

const port = process.env.HUB_E2E_PORT || '5201';
const origin = process.env.HUB_E2E_ORIGIN || `http://localhost:${port}`;
// Quiet CI may omit Wrangler's banner. Windows waits for it to avoid probing
// the local asset proxy during initialization; other hosts use HTTP readiness.
const readiness = process.platform === 'win32' && !process.env.CI
  ? { wait: { stdout: new RegExp(`Ready on http://(?:127\\.0\\.0\\.1|localhost):${port}\\b`) } }
  : { url: `${origin}/hub/` };

export default defineConfig({
  testDir: './e2e', timeout: 60000, workers: 1, retries: 0,
  use: { baseURL: origin, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build:assets && node scripts/dev.mjs --test',
    ...readiness,
    reuseExistingServer: false, timeout: 300000, env: { HUB_DEV_PORT: port } },
});
