// Object detection with and without small-object tiling (2026-10-02), on the cached COCO set.
//
// Runs the APP'S OWN YOLOX backend (src/features/proctoring/ai/objectDetection/yoloxBackend.ts, loaded
// through the Vite dev server) on every image in benchmarks/.cache/coco, twice per model:
//   * whole frame only, and
//   * whole frame + the four zoomed tiles (what the rotation covers over four processed frames).
// For each image and class it keeps the best confidence. It reports, at the app's PROVISIONAL
// thresholds, how often each class reaches the threshold — phones split by their size in the frame —
// and how often images without that object do (false positives). Numbers only; no image is written.
//
// COCO photos are not webcam frames: this measures the tiling effect and the models, not the
// production false-alarm rate. That is what the guided calibration session (npm run calibrate:objects)
// is for.
//
// Prerequisites: the dev server (`npm run dev`, http://localhost:1420) and the COCO cache
// (`node benchmarks/phone/prepare-coco.mjs`). Usage: node benchmarks/objects/tiling.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const cache = join(here, '..', '.cache', 'coco')
const ORIGIN = process.env.BENCH_ORIGIN ?? 'http://localhost:1420'
const manifest = JSON.parse(readFileSync(join(cache, 'manifest.json'), 'utf8'))
const entries = manifest.entries
const CLASSES = ['cell_phone', 'book', 'laptop', 'remote']
const MODELS = (process.env.BENCH_MODELS ?? 'yolox_s,yolox_tiny').split(',')

const browser = await chromium.launch({ channel: 'msedge', args: ['--enable-unsafe-webgpu'] })
const page = await browser.newPage()
await page.route(`${ORIGIN}/__bench/**`, (route) => {
  const file = route.request().url().split('/__bench/')[1]
  route.fulfill({ body: readFileSync(join(cache, 'images', file)), contentType: 'image/jpeg' })
})
await page.goto(ORIGIN)

const results = {}
for (const model of MODELS) {
  console.log(`[tiling] ${model}: loading…`)
  const run = await page.evaluate(
    async ({ model, files }) => {
      const { YoloxBackend } = await import('/src/features/proctoring/ai/objectDetection/yoloxBackend.ts')
      const { FULL_FRAME, TILES } = await import('/src/features/proctoring/ai/objectDetection/tiling.ts')
      const { YOLOX_S, YOLOX_TINY } = await import('/src/features/proctoring/ai/objectDetection/models.ts')
      const backend = await YoloxBackend.create(model, {
        // Absolute URLs, as the app passes them (Vite rewrites root-relative dynamic imports).
        models: {
          yolox_s: { url: `${location.origin}/models/yolox_s.onnx`, sha256: YOLOX_S.sha256 },
          yolox_tiny: { url: `${location.origin}/models/yolox_tiny.onnx`, sha256: YOLOX_TINY.sha256 },
        },
        wasmPaths: `${location.origin}/onnxruntime/`,
        preferWebGPU: true,
        warmupTimeoutMs: 60_000,
      })
      const labels = { 'cell phone': 'cell_phone', book: 'book', laptop: 'laptop', remote: 'remote' }
      const best = (objects) => {
        const out = { cell_phone: 0, book: 0, laptop: 0, remote: 0 }
        for (const o of objects) {
          const c = labels[o.category]
          if (c) out[c] = Math.max(out[c], o.score ?? 0)
        }
        return out
      }
      const rows = []
      const started = performance.now()
      for (const file of files) {
        const bitmap = await createImageBitmap(await (await fetch(`/__bench/${file}`)).blob())
        const full = best(await backend.detect(bitmap, [FULL_FRAME]))
        const tiled = best(await backend.detect(bitmap, [FULL_FRAME, ...TILES]))
        bitmap.close()
        rows.push({ file, full, tiled })
      }
      const report = backend.report
      await backend.release()
      const { OBJECT_THRESHOLDS } = await import('/src/features/proctoring/ai/events/config.ts')
      return { rows, report, ms: performance.now() - started, thresholds: OBJECT_THRESHOLDS }
    },
    { model, files: entries.map((e) => e.file) },
  )
  console.log(`[tiling] ${model}: ${run.report.accelerator}, ${Math.round(run.ms / 1000)} s for ${entries.length} images`)
  results[model] = run
}
await browser.close()

// The app's own provisional thresholds, as the page loaded them from events/config.ts.
const thresholds = Object.values(results)[0].thresholds

const byFile = new Map(entries.map((e) => [e.file, e]))
const rate = (rows, pick, cls, t) => (rows.length ? rows.filter((r) => pick(r)[cls] >= t).length / rows.length : null)
const pct = (v) => (v === null ? '—' : `${Math.round(v * 100)}%`)
const sizes = [
  ['tiny (< 1% of frame)', (a) => a < 0.01],
  ['small (1–5%)', (a) => a >= 0.01 && a < 0.05],
  ['large (≥ 5%)', (a) => a >= 0.05],
]

const lines = [
  '# Object detection: whole frame vs whole frame + tiles (COCO cache)',
  '',
  `Generated ${new Date().toISOString()} by benchmarks/objects/tiling.mjs. ${entries.length} COCO val2017 images (${manifest.source ?? 'COCO'}).`,
  'Rates are the share of images whose best candidate of the class reaches the provisional threshold.',
  'Single images, no temporal confirmation: the app additionally requires two sightings within 6 s.',
  '',
]
for (const [model, run] of Object.entries(results)) {
  const t = thresholds[model]
  const rows = run.rows.map((r) => ({ ...r, entry: byFile.get(r.file) }))
  lines.push(`## ${model} (${run.report.accelerator}; thresholds phone ${t.cell_phone}, book ${t.book}, laptop ${t.laptop}, remote ${t.remote})`, '')
  lines.push('| Images | n | Whole frame | + tiles |', '|---|---|---|---|')
  const phones = rows.filter((r) => r.entry.group === 'phone')
  for (const [name, test] of sizes) {
    const set = phones.filter((r) => test(r.entry.phoneAreaRatio ?? 0))
    lines.push(`| Phone, ${name} | ${set.length} | ${pct(rate(set, (r) => r.full, 'cell_phone', t.cell_phone))} | ${pct(rate(set, (r) => r.tiled, 'cell_phone', t.cell_phone))} |`)
  }
  lines.push(`| Phone, all | ${phones.length} | ${pct(rate(phones, (r) => r.full, 'cell_phone', t.cell_phone))} | ${pct(rate(phones, (r) => r.tiled, 'cell_phone', t.cell_phone))} |`)
  for (const cls of ['book', 'laptop', 'remote']) {
    const set = rows.filter((r) => r.entry.group === cls)
    lines.push(`| ${cls} images: ${cls} found | ${set.length} | ${pct(rate(set, (r) => r.full, cls, t[cls]))} | ${pct(rate(set, (r) => r.tiled, cls, t[cls]))} |`)
  }
  const phoneFree = rows.filter((r) => r.entry.group !== 'phone')
  lines.push(`| **False alarm:** phone-free images with a "phone" | ${phoneFree.length} | ${pct(rate(phoneFree, (r) => r.full, 'cell_phone', t.cell_phone))} | ${pct(rate(phoneFree, (r) => r.tiled, 'cell_phone', t.cell_phone))} |`)
  const plain = rows.filter((r) => r.entry.group === 'keyboard' || r.entry.group === 'mouse')
  for (const cls of ['book', 'laptop', 'remote']) {
    lines.push(`| Keyboard/mouse images with a "${cls}" (COCO scenes often contain one) | ${plain.length} | ${pct(rate(plain, (r) => r.full, cls, t[cls]))} | ${pct(rate(plain, (r) => r.tiled, cls, t[cls]))} |`)
  }
  lines.push('')
}
const out = join(here, 'results')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'tiling.md'), lines.join('\n') + '\n')
writeFileSync(join(out, 'tiling.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1))
console.log(lines.join('\n'))
