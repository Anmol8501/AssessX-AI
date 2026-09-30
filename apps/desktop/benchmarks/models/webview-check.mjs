// Runs the leading candidates inside the PACKAGED app's WebView2 (not Edge) under the app's own CSP.
//
// Start the release build with WebView2's debugging port first:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'; .\assessx-desktop.exe
// then: node benchmarks/models/webview-check.mjs
// The harness page is served with the Content-Security-Policy from src-tauri/tauri.conf.json, so a
// runtime that needs more than 'wasm-unsafe-eval' fails here as it would in the app. The WebView's
// shader cache persists between launches, so GPU "cold" numbers here may be partly warm.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { CANDIDATES, datasetCases, serve } from './run.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..', '..')
const csp = JSON.parse(readFileSync(join(app, 'src-tauri', 'tauri.conf.json'), 'utf8')).app.security.csp
const RUNS = [
  ['efficientdet-lite0', 'cpu'],
  ['yolox-nano', 'wasm'],
  ['yolox-nano', 'webgpu'],
  ['yolox-tiny', 'wasm'],
  ['yolox-tiny', 'webgpu'],
  ['dfine-n', 'wasm'],
  ['dfine-n', 'webgpu'],
]

const server = serve(datasetCases(), { csp })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222')
const page = browser.contexts()[0].pages()[0]
const original = page.url()
const violations = []
page.on('console', (m) => /Content Security Policy|Refused/i.test(m.text()) && violations.push(m.text().slice(0, 200)))
try {
  const workerChunk = readdirSync(join(app, 'dist', 'assets')).find((f) => /^worker-.*\.js$/.test(f))
  console.log(`CSP applied: ${csp}`)
  for (const [id, ep] of RUNS) {
    await page.goto('http://localhost:4180/')
    await page.waitForFunction(() => window.bench !== undefined)
    const adapter = await page.evaluate(() => window.bench.webgpu())
    const candidate = CANDIDATES.find((c) => c.id === id)
    try {
      const spec = { ...candidate, ep, workerChunk, gpu: ep === 'webgpu' || ep === 'gpu' }
      const loaded = await page.evaluate((s) => window.bench.load(s), spec)
      const first = await page.evaluate(() => window.bench.infer('synthetic:#808080'))
      for (let i = 0; i < 5; i++) await page.evaluate(() => window.bench.infer('synthetic:#808080'))
      const steady = []
      for (let i = 0; i < 15; i++) steady.push((await page.evaluate(() => window.bench.infer('synthetic:#808080'))).inferMs)
      steady.sort((a, b) => a - b)
      await page.evaluate(() => window.bench.release())
      console.log(`${id} / ${ep}: load ${Math.round(loaded.loadMs)} ms, first ${Math.round(first.inferMs)} ms, steady median ${Math.round(steady[7])} ms${ep === 'webgpu' ? ` | adapter ${JSON.stringify(adapter)}` : ''}`)
    } catch (error) {
      console.log(`${id} / ${ep}: FAILED — ${String(error.message ?? error).slice(0, 200)}`)
    }
  }
  console.log('CSP violations:', violations.length ? violations : 'none')
} finally {
  await page.goto(original).catch(() => undefined)
  await browser.close()
  server.close()
}
