import { defineConfig } from '@playwright/test';
import { availableParallelism } from 'node:os';

/* Playwright harness — ported from the proven lemon_schedule/ui-kit setups.
   Runs the PRODUCTION preview build — boots are ~2x faster than the dev server.

   Default port 4101 is TEST-ONLY (the human dev server keeps its own).
   PLAYWRIGHT_PORT forces an isolated, OWNED server (no reuse) for hermetic runs. */

const PORT = Number(process.env.PLAYWRIGHT_PORT) || 4102;
const isolated = process.env.PLAYWRIGHT_PORT !== undefined;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // Distribute tests WITHIN a file across workers too — specs must be
  // independent (fresh context per test; each starts with its own goto/setup).
  // Order-dependent specs opt out: test.describe.configure({ mode: 'serial' }).
  fullyParallel: true,
  // Retry once locally (twice on CI) so a transient flake doesn't read as a
  // regression. The first retry records a trace. Chronic flakers are tagged
  // `@quarantine` (excluded below) rather than retried forever.
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // Tests aren't about animation: reduced motion removes the transition
    // clones/timeouts that make interaction specs flaky ("element is not
    // stable"/"detached"). Specs ABOUT the animation opt back in with:
    //   test.use({ contextOptions: { reducedMotion: 'no-preference' } });
    contextOptions: { reducedMotion: 'reduce' },
  },
  // Each worker is a full browser; 5 (cores/2 on a 10-core Mac) is the proven
  // baseline. Raise deliberately: PLAYWRIGHT_WORKERS=8 npx playwright test.
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number(process.env.PLAYWRIGHT_WORKERS)
    : Math.min(5, availableParallelism()),
  reporter: [['list'], ['./pw-duration-reporter.mjs']],
  webServer: {
    command: `npm run build && npm run start:test`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !isolated,
    timeout: 120000,
  },
  // Perf/memory harnesses and known-flaky specs stay out of the default run:
  //   npx playwright test --grep @perf   /   --grep @quarantine
  grepInvert: /@perf|@quarantine/,
});
