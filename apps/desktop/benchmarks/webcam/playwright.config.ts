import { defineConfig } from '@playwright/test'

/**
 * Guided real-webcam validation session (Phase 5B). Not part of the automated suite.
 *
 *   npx playwright test --config benchmarks/webcam/playwright.config.ts
 *
 * Opens a visible Microsoft Edge window on the real camera and walks the participant through the
 * scenarios on screen. Set SESSION_CAMERA=synthetic to dry-run the harness without a camera.
 * Prerequisites: the backend running (as for the E2E suite).
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['session.spec.ts', 'events-session.spec.ts'],
  timeout: 15 * 60_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:1420',
    channel: 'msedge',
    // Visible for a real participant; the synthetic dry run needs no window.
    headless: process.env.SESSION_CAMERA === 'synthetic',
    viewport: { width: 1366, height: 768 },
  },
  webServer: { command: 'npm run dev', cwd: '../..', url: 'http://localhost:1420', reuseExistingServer: true, timeout: 60_000 },
})
