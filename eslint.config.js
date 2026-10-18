import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '.tmp/**', '.wrangler/**', 'public/hub/assets/**', 'worker-configuration.d.ts', 'playwright-report/**', 'test-results/**'] },
  { files: ['**/*.ts'], extends: [js.configs.recommended, ...tseslint.configs.recommended] },
  { files: ['**/*.mjs', 'eslint.config.js'], extends: [js.configs.recommended], languageOptions: { globals: globals.node } },
  { files: ['scripts/audit/audit-browser-transport.mjs', 'scripts/audit/audit-viewer-sample.mjs'], languageOptions: { globals: globals.browser } },
  { files: ['src/client/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [{
    group: ['**/worker/**', 'node:*', 'cloudflare:*'], message: 'Browser code may use shared modules; keep server APIs in the Worker.',
  }] }] } },
  { files: ['src/worker/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [{
    group: ['**/client/**'], message: 'Worker code may use shared modules; keep browser controls in the client.',
  }] }] } },
  { files: ['src/shared/**/*.ts'], rules: { 'no-restricted-imports': ['error', { patterns: [{
    group: ['**/worker/**', '**/client/**', 'node:*', 'cloudflare:*'], message: 'Shared modules must work in both browser and Worker runtimes.',
  }] }] } },
);
