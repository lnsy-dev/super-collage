// @ts-check
import { defineConfig, devices } from '@playwright/test';

// Feature agents work in separate git worktrees; ports must not collide with
// an already-running server for another checkout (webServer.reuseExistingServer
// would otherwise silently serve the wrong directory's code).
const E2E_PORT = Number(process.env.E2E_PORT || 3421);

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Single worker: IndexedDB is shared per origin
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html', { outputFolder: 'e2e-report' }], ['list']],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 5000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-slow',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--disable-gpu'] },
      },
    },
  ],
  webServer: {
    command: `npx browser-sync start --server . --port ${E2E_PORT} --no-notify --no-open`,
    url: `http://localhost:${E2E_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});
