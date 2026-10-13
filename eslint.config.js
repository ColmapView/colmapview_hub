import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '.tmp/**', '.wrangler/**', 'public/assets/**', 'worker-configuration.d.ts', 'playwright-report/**', 'test-results/**'] },
  { files: ['**/*.ts'], extends: [js.configs.recommended, ...tseslint.configs.recommended] },
);
