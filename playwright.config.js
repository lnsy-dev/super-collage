// @ts-check
import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://localhost:8765',
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
    command: 'npx browser-sync start --server . --port 8765 --no-notify --no-open',
    url: 'http://localhost:8765',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});
