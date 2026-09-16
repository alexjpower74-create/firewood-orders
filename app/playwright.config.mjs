// Firewood Orders end-to-end suite. Lead-owned: slices ask the lead for changes in their report.
// Every spec runs against the real Worker (it serves app/public), started fresh by tests/start-worker.mjs on E2E_PORT
// with TEST_MODE=1. One worker: the specs share one D1.
//   fo2:  E2E_PORT=7703 npx playwright test tests/web
//   fo1:  E2E_PORT=7704 npx playwright test tests/driver
//   lead: E2E_PORT=7708 npx playwright test tests/journey    QA: E2E_PORT=7709 npx playwright test
// E2E_WORKER_DIR points the server at a copy of worker/ (negative controls); default ../worker.
import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 7703)

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  outputDir: './tests/results',
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/start-worker.mjs',
    url: `http://127.0.0.1:${PORT}/api/info`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: { E2E_PORT: String(PORT), E2E_WORKER_DIR: process.env.E2E_WORKER_DIR || '' },
  },
  projects: [
    {
      name: 'chromium-390',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    },
    { name: 'chromium-1280', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'webkit-390', use: { ...devices['iPhone 14'], browserName: 'webkit' } },
    { name: 'webkit-1280', use: { browserName: 'webkit', viewport: { width: 1280, height: 800 } } },
  ],
})
