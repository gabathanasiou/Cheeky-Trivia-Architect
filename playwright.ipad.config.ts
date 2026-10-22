import { defineConfig, devices } from '@playwright/test';

/* iPad/WebKit project for touch/keyboard/viewport specs (the exact device
   config the app uses). Run explicitly: npx playwright test -c
   playwright.ipad.config.ts. Tag the specs it should run `@ipad` and keep the
   default suite Chromium-only (or run both projects — see the main config). */
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4101',
    headless: true,
    screenshot: 'only-on-failure',
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    command: `npm run build && npm run preview -- --port=4101 --strictPort`,
    url: `http://localhost:4101`,
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    {
      name: 'ipad',
      use: {
        ...devices['iPad Pro 11'],
        browserName: 'webkit',
        hasTouch: true,
      },
    },
  ],
});
