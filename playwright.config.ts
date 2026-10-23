import { defineConfig } from '@playwright/test';

const port = process.env.HUB_E2E_PORT || '5201';
const origin = process.env.HUB_E2E_ORIGIN || `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e', timeout: 60000, workers: 1, retries: 0,
  use: { baseURL: origin, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build:assets && node scripts/dev.mjs --test',
    wait: { stdout: new RegExp(`Ready on http://(?:127\\.0\\.0\\.1|localhost):${port}\\b`) },
    reuseExistingServer: false, timeout: 300000, env: { HUB_DEV_PORT: port } },
});
