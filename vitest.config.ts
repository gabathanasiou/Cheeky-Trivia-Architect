import { defineConfig } from 'vitest/config';

/* Pure-logic unit tests (the bottom of the pyramid — see docs/TESTING.md).
   Node environment, no DOM: tests live next to the code as src NAME.test.ts.
   DOM-bound modules opt into jsdom per file with `// @vitest-environment jsdom`.
   Run: `npm run test:unit` (watch: `npm run test:unit:watch`). */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
