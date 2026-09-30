// Guided live-webcam comparison of the candidate phone detectors (Phase 5B model evaluation).
// Opens a visible Edge window on the real camera; the participant follows the on-screen steps.
// Records only each model's phone score per frame (numbers) to benchmarks/.cache/webcam/.
// Usage: node benchmarks/models/live-session.mjs
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { datasetCases, serve } from './run.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..', '..')
const STEPS = [
  ['no-phone', 'Sit normally. Keep any phone OUT of view.', 'no-phone'],
  ['phone-portrait-close', 'Hold your PHONE upright (portrait), CLOSE to the camera, screen facing it.', 'phone'],
  ['phone-portrait-far', 'Hold your PHONE upright at ARM’S LENGTH.', 'phone'],
  ['phone-landscape', 'Hold your PHONE SIDEWAYS (landscape), facing the camera.', 'phone'],
  ['phone-back', 'Hold your PHONE with its BACK facing the camera.', 'phone'],
  ['phone-in-hand-low', 'Hold your PHONE in your hand at chest height, as if typing on it.', 'phone'],
  ['phone-partial', 'Hold your PHONE HALF out of view, at the edge of the picture.', 'phone'],
  ['neg-hands', 'Show both EMPTY HANDS (no phone).', 'no-phone'],
  ['neg-desk-objects', 'Hold up a MOUSE, CHARGER or USB STICK (no phone). Skip if none.', 'no-phone'],
  ['neg-other-objects', 'Hold up a REMOTE, CALCULATOR or BOOK (no phone). Skip if none.', 'no-phone'],
  ['neg-laptop', 'If you can, turn ANOTHER laptop/tablet/keyboard toward the camera (no phone). Skip if not.', 'no-phone'],
  ['no-phone-end', 'Sit normally again. No phone in view.', 'no-phone'],
]
// --production: both detectors through the app's own AI worker (Phase 5B YOLOX integration check).
const production = process.argv.includes('--production')
const PRODUCTION_STEPS = [
  ['no-phone', 'Sit normally. Keep any phone OUT of view.', 'no-phone'],
  ['phone-in-hand', 'Hold your PHONE in your hand at chest height, as if using it.', 'phone'],
  ['phone-close', 'Hold your PHONE CLOSE to the camera, screen facing it.', 'phone'],
  ['phone-partial', 'Hold your PHONE HALF out of view, at the edge of the picture.', 'phone'],
  ['phone-on-desk', 'Put your PHONE on the desk where the camera can see it (tilt the screen if needed). Skip if the camera cannot see the desk.', 'phone'],
  ['phone-portrait', 'Hold your PHONE upright (portrait) at a normal distance.', 'phone'],
  ['phone-landscape', 'Hold your PHONE sideways (landscape).', 'phone'],
  ['phone-tilted-back', 'Tilt your PHONE at an angle, BACK facing the camera.', 'phone'],
  ['neg-hands', 'Show both EMPTY HANDS (no phone).', 'no-phone'],
  ['neg-desk-objects', 'Hold up a MOUSE, CHARGER, REMOTE or similar object (no phone). Skip if none.', 'no-phone'],
  ['no-phone-end', 'Sit normally again. No phone in view.', 'no-phone'],
]
if (production) STEPS.splice(0, STEPS.length, ...PRODUCTION_STEPS)
const MODELS = production ? ['efficientdet-lite0', 'yolox-tiny'] : ['efficientdet-lite0', 'yolox-tiny', 'yolox-s', 'dfine-n']

const server = serve(datasetCases())
const fake = process.env.LIVE_FAKE === '1' // dry run with Edge's synthetic camera
const browser = await chromium.launch({
  channel: 'msedge',
  headless: fake, // a dry run needs no visible window
  args: ['--enable-unsafe-webgpu', ...(fake ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : [])],
})
try {
  const context = await browser.newContext({ permissions: ['camera'], viewport: { width: 1100, height: 760 } })
  const page = await context.newPage()
  await page.goto('http://localhost:4180/')
  await page.evaluate(() => {
    document.body.style.cssText = 'margin:0;padding:24px;background:#111827;color:#f9fafb;font:16px system-ui'
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div style="font-size:12px;color:#9ca3af;letter-spacing:.08em">PHONE-DETECTOR MODEL COMPARISON — no images are recorded</div><div id="step" style="font-size:24px;font-weight:600;margin:10px 0">Loading models…</div><div id="count" style="font-size:36px;font-weight:700"></div><button id="skip" style="margin:8px 0 16px;padding:8px 12px;border:0;border-radius:6px;background:#374151;color:#fff;cursor:pointer">Skip — I don’t have this item</button><br>',
    )
    window.__skip = false
    document.getElementById('skip').onclick = () => {
      window.__skip = true
      document.getElementById('skip').textContent = 'Skipped'
    }
  })
  await page.addScriptTag({ type: 'module', url: '/live.js' })
  await page.waitForFunction(() => typeof window.startLive === 'function')
  const workerChunk = readdirSync(join(app, 'dist', 'assets')).find((f) => /^worker-.*\.js$/.test(f))
  void page.evaluate(([chunk, prod]) => (prod ? window.startProductionLive(chunk) : window.startLive(chunk)), [workerChunk, production])
  await page.waitForFunction(() => window.live?.status === 'ready', undefined, { timeout: 180_000 })

  const summary = {}
  for (const [index, [id, text, label]] of STEPS.entries()) {
    const show = (title, seconds) =>
      page.evaluate(([t, s]) => {
        document.getElementById('step').textContent = t
        const c = document.getElementById('count')
        let left = s
        c.textContent = `${left}s`
        clearInterval(window.__timer)
        window.__timer = setInterval(() => (c.textContent = `${(left = Math.max(0, left - 1))}s`), 1000)
      }, [title, seconds])
    await page.evaluate(() => {
      window.__skip = false
      document.getElementById('skip').textContent = 'Skip — I don’t have this item'
    })
    await show(`Step ${index + 1}/${STEPS.length} — get ready…`, 3)
    await page.waitForTimeout(3000)
    await show(`Step ${index + 1}/${STEPS.length}: ${text}`, 10)
    const start = await page.evaluate(() => performance.now())
    await page.waitForTimeout(10_000)
    const end = await page.evaluate(() => performance.now())
    const skipped = await page.evaluate(() => window.__skip)
    const frames = await page.evaluate(([s, e]) => window.live.records.filter((r) => r.t >= s && r.t <= e), [start, end])
    const perModel = {}
    for (const m of MODELS) {
      const v = frames.map((f) => f.scores[m]).filter((x) => typeof x === 'number').sort((a, b) => a - b)
      perModel[m] = v.length ? { n: v.length, median: +v[Math.floor((v.length - 1) / 2)].toFixed(3), p90: +v[Math.floor(0.9 * (v.length - 1))].toFixed(3), max: +v[v.length - 1].toFixed(3) } : null
    }
    summary[id] = { label, instruction: text, skipped, frames: frames.length, perModel, perFrame: frames.map((f) => f.scores) }
    console.log(`${id.padEnd(22)} ${skipped ? 'SKIPPED ' : ''}frames ${String(frames.length).padStart(3)} | ` + MODELS.map((m) => `${m} ${perModel[m] ? `${perModel[m].median}/${perModel[m].max}` : '—'}`).join(' | '))
  }
  await page.evaluate(() => {
    window.live.running = false
    document.getElementById('step').textContent = 'Finished — thank you. The camera is being released.'
    document.getElementById('count').textContent = ''
  })
  await page.waitForFunction(() => window.live.status === 'stopped', undefined, { timeout: 30_000 })
  const dir = join(here, '..', '.cache', 'webcam')
  mkdirSync(dir, { recursive: true })
  const backends = await page.evaluate(() => window.live.backends ?? null)
  const file = join(dir, `models-live-${production ? 'production-' : ''}${Date.now()}.json`)
  writeFileSync(file, JSON.stringify({ when: new Date().toISOString(), mode: production ? 'production worker' : 'evaluation adapters', backends, steps: summary }, null, 1))
  if (backends) console.log('[live] backends:', JSON.stringify(backends))
  console.log(`[live] results (numbers only) written to ${file}`)
} finally {
  await browser.close()
  server.close()
}
