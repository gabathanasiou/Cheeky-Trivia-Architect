import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

// Minimal, type-aware lint for the e2e specs ONLY. The one rule that pays for
// itself: `no-floating-promises` — a missing `await` on a Playwright call is a
// classic flaky-test generator. Wire into `npm run lint` (lint:tests).
// Requires devDeps: eslint, typescript-eslint.
export default tseslint.config(tseslint.configs.base, {
  files: ['e2e/**/*.ts'],
  languageOptions: {
    parserOptions: {
      project: './tsconfig.json',
      tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
  },
});
