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
  timeout: 30_000, // A test that takes longer than this is considered broken
  maxFailures: 0, // Run full suite for comprehensive results
  forbidOnly: !!process.env.CI,
  // Full-suite runs on shared dev machines see single-worker load spikes
  // (other agents' test servers, browser churn) that intermittently trip
  // otherwise-passing specs (zoom, transform, project-io, masks, text, etc.).
  // One local retry absorbs those; a deterministic failure still fails after
  // the retry, so real bugs are not masked.
  retries: process.env.CI ? 2 : 1,
  reporter: [['html', { outputFolder: 'e2e-report' }], ['list']],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    actionTimeout: 5000,
  },
  expect: {
    // Default 5s is too tight for assertions polled under full-suite machine
    // load; 10s still fails fast when the app is genuinely broken.
    timeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
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
