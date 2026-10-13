import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', timeout: 60000, workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:5201', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run build:client && node scripts/dev.mjs --test', url: 'http://localhost:5201/hub/', reuseExistingServer: false, timeout: 90000 },
});
