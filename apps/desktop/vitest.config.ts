import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests for pure logic (Phase 5B: detectors, tracking, pose/gaze maths, scheduling, pipeline).
// Browser behaviour is covered by the Playwright suite in e2e/, which vitest must not pick up.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
