import { defineConfig } from '@playwright/test'

/**
 * End-to-end tests for the desktop UI against the real backend.
 *
 * Prerequisites (see apps/desktop/README.md):
 *   - backend running on http://127.0.0.1:8000 with APP_ENV=development and `seed-dev-users` applied
 *   - the Vite dev server is started automatically (or reused when already running on :1420)
 *
 * Runs in the system Microsoft Edge (WebView2 shares its engine), so no browser download is needed.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:1420',
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
