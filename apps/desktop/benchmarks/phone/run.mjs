// Phone-detector validation run (Phase 5B).
//
// Feeds every labelled image to the PRODUCTION MediaPipe worker (the built bundle in dist/, served by
// `vite preview`, in Microsoft Edge) exactly as the exam does — same models, same options (cell
// phone only, top-1 candidate, CPU) — and records the phone confidence it reports. It then prints the
// score distribution per group and a threshold sweep. It chooses no threshold: the sweep only shows
// the trade-off the data supports (see README.md for how to read it).
//
// Prerequisites: `npm run build`, then `node benchmarks/phone/prepare-coco.mjs`.
// Usage: node benchmarks/phone/run.mjs

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..', '..')
const cache = join(here, '..', '.cache')
const PORT = 4173
const ORIGIN = `http://localhost:${PORT}`

/** MediaPipe's own published test images (Apache-2.0 test assets): negatives with hands / a face. */
const MEDIAPIPE_ASSETS = ['thumb_up.jpg', 'pointing_up.jpg', 'pointing_up_rotated.jpg', 'victory.jpg', 'fist.jpg', 'right_hands.jpg', 'left_hands.jpg', 'portrait.jpg']
const THRESHOLDS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8]

async function mediapipeAssets() {
  const dir = join(cache, 'mediapipe-assets')
  mkdirSync(dir, { recursive: true })
  const entries = []
  for (const file of MEDIAPIPE_ASSETS) {
    const path = join(dir, file)
    if (!existsSync(path)) {
      const response = await fetch(`https://storage.googleapis.com/mediapipe-assets/${file}`)
      if (!response.ok) continue
      writeFileSync(path, Buffer.from(await response.arrayBuffer()))
    }
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
    entries.push({ file, path, label: 'no-phone', group: file === 'portrait.jpg' ? 'face (portrait)' : 'hands', sha256 })
  }
  return entries
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] : null)
  const f = (v) => (v === null ? '—' : v.toFixed(3))
  return { n: sorted.length, min: f(at(0)), p10: f(at(0.1)), median: f(at(0.5)), p90: f(at(0.9)), max: f(at(1)) }
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(ORIGIN)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('vite preview did not start')
}

async function main() {
  const manifest = JSON.parse(readFileSync(join(cache, 'coco', 'manifest.json'), 'utf8'))
  const cases = [
    ...manifest.entries.map((e) => ({ ...e, path: join(cache, 'coco', 'images', e.file), source: 'COCO val2017' })),
    ...(await mediapipeAssets()).map((e) => ({ ...e, source: 'MediaPipe test assets' })),
    { file: 'synthetic-grey', group: 'empty frame', label: 'no-phone', source: 'synthetic', synthetic: '#808080' },
    { file: 'synthetic-black', group: 'empty frame', label: 'no-phone', source: 'synthetic', synthetic: '#000000' },
  ]
  const workerChunk = readdirSync(join(app, 'dist', 'assets')).find((f) => /^worker-.*\.js$/.test(f))
  if (!workerChunk) throw new Error('dist/ has no worker chunk — run `npm run build` first')

  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: app, shell: true, stdio: 'ignore' })
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  try {
    await waitForServer()
    const page = await browser.newPage()
    await page.route('**/__bench/**', (route) => {
      const name = decodeURIComponent(route.request().url().split('/__bench/')[1])
      const hit = cases.find((c) => c.file === name && c.path)
      return hit ? route.fulfill({ body: readFileSync(hit.path), contentType: 'image/jpeg' }) : route.fulfill({ status: 404 })
    })
    await page.goto(ORIGIN)
    const loaded = await page.evaluate(async (chunk) => {
      const at = (p) => new URL(p, location.origin).toString()
      const worker = new Worker(`/assets/${chunk}`, { type: 'module' })
      window.__bench = { worker, next: 1 }
      return await new Promise((resolve, reject) => {
        worker.onmessage = (e) => resolve(e.data)
        worker.onerror = (e) => reject(new Error(e.message))
        worker.postMessage({
          type: 'load',
          config: {
            wasmLoaderPath: at('/mediapipe/wasm/vision_wasm_module_internal.js'),
            wasmBinaryPath: at('/mediapipe/wasm/vision_wasm_module_internal.wasm'),
            models: {
              faceDetector: at('/models/blaze_face_short_range.tflite'),
              faceLandmarker: at('/models/face_landmarker.task'),
              objectDetector: at('/models/efficientdet_lite0.tflite'),
            },
            preferGpu: false,
            objectCategories: ['cell phone'],
            landmarkerMaxFaces: 1,
          },
        })
      })
    }, workerChunk)
    if (loaded.type !== 'loaded' || loaded.tasks.objectDetector !== 'READY') throw new Error(`runtime did not load: ${JSON.stringify(loaded)}`)

    const results = []
    for (const c of cases) {
      const outcome = await page.evaluate(async ({ file, synthetic }) => {
        let bitmap
        if (synthetic) {
          const canvas = new OffscreenCanvas(640, 480)
          const ctx = canvas.getContext('2d')
          ctx.fillStyle = synthetic
          ctx.fillRect(0, 0, 640, 480)
          bitmap = canvas.transferToImageBitmap()
        } else {
          bitmap = await createImageBitmap(await (await fetch(`/__bench/${encodeURIComponent(file)}`)).blob())
        }
        const { worker } = window.__bench
        const id = window.__bench.next++
        const width = bitmap.width
        const height = bitmap.height
        const response = await new Promise((resolve) => {
          worker.onmessage = (e) => resolve(e.data)
          worker.postMessage({ type: 'infer', id, timestampMs: id * 1000, bitmap }, [bitmap])
        })
        if (response.type !== 'result') return { error: response.error ?? response.type }
        const top = response.payload.objects?.[0] ?? null
        return { width, height, phoneScore: top?.score ?? null, phoneBox: top?.box ?? null, objectMs: response.payload.timingsMs.objectDetector }
      }, c)
      results.push({ file: c.file, source: c.source, group: c.group, label: c.label, license: c.license ?? null, phoneAreaRatio: c.phoneAreaRatio ?? null, ...outcome })
    }
    await page.evaluate(() => window.__bench.worker.terminate())

    // ---- report ---------------------------------------------------------------------------------
    const score = (r) => r.phoneScore ?? 0
    const groups = [...new Set(results.map((r) => r.group))]
    const lines = []
    lines.push(`Images: ${results.length} (${results.filter((r) => r.label === 'phone').length} with a phone, ${results.filter((r) => r.label === 'no-phone').length} without). Errors: ${results.filter((r) => r.error).length}.`)
    lines.push('', '| Group | Label | n | min | p10 | median | p90 | max |', '|---|---|---|---|---|---|---|---|')
    for (const g of groups) {
      const rows = results.filter((r) => r.group === g && !r.error)
      const s = stats(rows.map(score))
      lines.push(`| ${g} | ${rows[0]?.label} | ${s.n} | ${s.min} | ${s.p10} | ${s.median} | ${s.p90} | ${s.max} |`)
    }
    const positives = results.filter((r) => r.label === 'phone' && !r.error)
    const buckets = [
      ['phone < 1% of frame', (r) => r.phoneAreaRatio < 0.01],
      ['phone 1–5% of frame', (r) => r.phoneAreaRatio >= 0.01 && r.phoneAreaRatio < 0.05],
      ['phone ≥ 5% of frame', (r) => r.phoneAreaRatio >= 0.05],
    ]
    lines.push('', '| Phone size (largest annotated) | n | median score |', '|---|---|---|')
    for (const [name, test] of buckets) {
      const rows = positives.filter(test)
      lines.push(`| ${name} | ${rows.length} | ${stats(rows.map(score)).median} |`)
    }
    const negatives = results.filter((r) => r.label === 'no-phone' && !r.error)
    lines.push('', '| Threshold | Phones at/above (recall on this set) | Phone-free images at/above (false positives) | Of which remote |', '|---|---|---|---|')
    for (const t of THRESHOLDS) {
      const tp = positives.filter((r) => score(r) >= t).length
      const fp = negatives.filter((r) => score(r) >= t)
      lines.push(`| ${t} | ${tp}/${positives.length} (${((100 * tp) / positives.length).toFixed(0)}%) | ${fp.length}/${negatives.length} | ${fp.filter((r) => r.group === 'remote').length}/${negatives.filter((r) => r.group === 'remote').length} |`)
    }
    const highestNegatives = [...negatives].sort((a, b) => score(b) - score(a)).slice(0, 10)
    lines.push('', 'Highest-scoring phone-free images:', ...highestNegatives.map((r) => `- ${r.file} (${r.group}): ${score(r).toFixed(3)}`))
    const lowestPositives = [...positives].sort((a, b) => score(a) - score(b)).slice(0, 5)
    lines.push('', 'Lowest-scoring phone images:', ...lowestPositives.map((r) => `- ${r.file} (phone ${(100 * r.phoneAreaRatio).toFixed(2)}% of frame): ${score(r).toFixed(3)}`))
    const objectMs = stats(results.filter((r) => !r.error).map((r) => r.objectMs))
    lines.push('', `Object-detector time per image (CPU): median ${objectMs.median} ms, p90 ${objectMs.p90} ms.`)

    const outDir = join(here, 'results')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'latest.json'), JSON.stringify({ runtime: '@mediapipe/tasks-vision 1.0.1', model: 'efficientdet_lite0.tflite float16 v1', delegate: 'CPU', results }, null, 1))
    writeFileSync(join(outDir, 'latest.md'), lines.join('\n') + '\n')
    console.log(lines.join('\n'))
  } finally {
    await browser.close()
    server.kill()
    if (process.platform === 'win32' && server.pid) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}

main().catch((error) => {
  console.error('[bench]', error.message)
  process.exit(1)
})
