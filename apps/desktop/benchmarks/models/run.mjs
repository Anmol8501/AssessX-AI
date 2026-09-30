// Object-detector model evaluation (Phase 5B) — an engineering comparison, not an accuracy study.
//
// Runs each candidate model on the same labelled images (the phone benchmark set) in Microsoft Edge,
// on CPU (WebAssembly) and GPU (MediaPipe GPU delegate / ONNX Runtime WebGPU), and records:
//   * cold start  — model load + first inference, in a freshly launched browser (no shader cache);
//   * steady state — median/p90 of 20 inferences after 5 warm-up runs on the same frame;
//   * the highest "cell phone" score per image (dataset scoring on CPU, the reference path),
//     plus a CPU-vs-GPU score parity check on a sample.
// No threshold is chosen. Results go to benchmarks/models/results/; compare.mjs summarises them.
//
// Prerequisites: `npm run build` (app bundle), `node benchmarks/phone/prepare-coco.mjs`,
// `npm install` in this folder, and the models in benchmarks/.cache/models/ (see README).
// Usage: node benchmarks/models/run.mjs [candidate-id ...] [--dataset=<validation-dataset-dir>]
//   --dataset runs on a labelled webcam validation dataset (see benchmarks/validation/README.md)
//   instead of the COCO set; it is validated first and results go to results/<dataset-name>/.

import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import { validateDataset } from '../validation/validate.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, '..', '..')
const cache = join(here, '..', '.cache')
const PORT = 4180

export const CANDIDATES = [
  { id: 'efficientdet-lite0', runtime: 'mediapipe', model: 'efficientdet_lite0.tflite', eps: ['cpu', 'gpu'] },
  { id: 'efficientdet-lite2', runtime: 'mediapipe', model: 'efficientdet_lite2.tflite', eps: ['cpu', 'gpu'] },
  { id: 'yolox-nano', runtime: 'onnx', model: 'yolox_nano.onnx', adapter: 'yolox', size: 416, eps: ['wasm', 'webgpu'] },
  { id: 'yolox-tiny', runtime: 'onnx', model: 'yolox_tiny.onnx', adapter: 'yolox', size: 416, eps: ['wasm', 'webgpu'] },
  { id: 'yolox-s', runtime: 'onnx', model: 'yolox_s.onnx', adapter: 'yolox', size: 640, eps: ['wasm', 'webgpu'] },
  { id: 'dfine-n', runtime: 'onnx', model: 'dfine_n_coco.onnx', adapter: 'dfine', size: 640, eps: ['wasm', 'webgpu'], phoneLabel: 67 },
  { id: 'dfine-s', runtime: 'onnx', model: 'dfine_s_coco.onnx', adapter: 'dfine', size: 640, eps: ['wasm', 'webgpu'], phoneLabel: 67 },
  // The app's own YOLOX-Tiny integration (production worker, objectModel = yolox_tiny), scored on
  // both backends over the full dataset so CPU/WebGPU drift covers scores and boxes.
  {
    id: 'yolox-tiny-app',
    runtime: 'mediapipe',
    objectModel: 'yolox_tiny',
    model: 'yolox_tiny.onnx',
    yoloxSha256: '427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7',
    eps: ['wasm', 'webgpu'],
    scoreAllEps: true,
  },
]

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.jpg': 'image/jpeg', '.json': 'application/json' }

/** Cases from a validated webcam dataset (manifest.schema.json): PHONE_PRESENT → phone. */
export function validationCases(dir) {
  const { problems, manifest } = validateDataset(dir)
  if (problems.length) throw new Error(`dataset is invalid (${problems.length} problems) — run benchmarks/validation/validate.mjs ${dir}`)
  return {
    name: manifest.dataset.name,
    cases: manifest.samples.map((s) => ({
      image: `${s.id}${extname(s.file)}`,
      path: join(dir, s.file),
      label: s.label === 'PHONE_PRESENT' ? 'phone' : 'no-phone',
      group: s.label === 'PHONE_PRESENT' ? `phone ${s.phone_visibility} ${s.phone_size}` : `no phone: ${s.distractor_type}`,
      phoneAreaRatio: s.phone_box ? s.phone_box.width * s.phone_box.height : null,
      scenario: { person: s.person, camera: s.camera, room: s.room, lighting: s.lighting, phone_position: s.phone_position ?? null, phone_orientation: s.phone_orientation ?? null, split: s.split },
    })),
  }
}

export function datasetCases() {
  const manifest = JSON.parse(readFileSync(join(cache, 'coco', 'manifest.json'), 'utf8'))
  const cases = manifest.entries.map((e) => ({ image: e.file, group: e.group, label: e.label, phoneAreaRatio: e.phoneAreaRatio ?? null, path: join(cache, 'coco', 'images', e.file) }))
  const mp = join(cache, 'mediapipe-assets')
  if (existsSync(mp)) {
    for (const file of readdirSync(mp)) cases.push({ image: file, group: file === 'portrait.jpg' ? 'face (portrait)' : 'hands', label: 'no-phone', phoneAreaRatio: null, path: join(mp, file) })
  }
  cases.push({ image: 'synthetic:#808080', group: 'empty frame', label: 'no-phone', phoneAreaRatio: null })
  cases.push({ image: 'synthetic:#000000', group: 'empty frame', label: 'no-phone', phoneAreaRatio: null })
  return cases
}

export function serve(cases, { csp = null } = {}) {
  const images = new Map(cases.filter((c) => c.path).map((c) => [c.image, c.path]))
  const roots = {
    '/ort/': join(here, 'node_modules', 'onnxruntime-web', 'dist'),
    '/app/': join(app, 'dist'),
    '/ort-runtime/': join(app, 'node_modules', 'onnxruntime-web', 'dist'), // same version the app bundles
    '/models/': join(cache, 'models'),
  }
  return createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = null
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html', ...(csp ? { 'content-security-policy': csp } : {}) })
      return res.end('<!doctype html><meta charset="utf-8"><title>bench</title><script type="module" src="/bench.js"></script>')
    }
    if (url === '/bench.js' || url === '/live.js') file = join(here, url.slice(1))
    else if (url.startsWith('/img/')) file = images.get(url.slice(5)) ?? null
    else for (const [prefix, root] of Object.entries(roots)) if (url.startsWith(prefix)) file = join(root, url.slice(prefix.length))
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  }).listen(PORT)
}

const median = (v) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) / 2)]
const p90 = (v) => [...v].sort((a, b) => a - b)[Math.floor(0.9 * (v.length - 1))]

async function evaluate(candidate, ep, cases, workerChunk) {
  const gpu = ep === 'gpu' || ep === 'webgpu'
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: gpu ? ['--enable-unsafe-webgpu'] : [] })
  try {
    const page = await browser.newPage()
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForFunction(() => window.bench !== undefined)
    const webgpu = await page.evaluate(() => window.bench.webgpu())
    if (ep === 'webgpu' && !webgpu) return { candidate: candidate.id, ep, unavailable: 'WebGPU adapter not available' }

    const spec = { ...candidate, ep, workerChunk, gpu }
    const probe = 'synthetic:#808080'
    const loaded = await page.evaluate((s) => window.bench.load(s), spec)
    const first = await page.evaluate((i) => window.bench.infer(i), probe)
    for (let i = 0; i < 5; i++) await page.evaluate((x) => window.bench.infer(x), probe)
    const steady = []
    for (let i = 0; i < 20; i++) steady.push((await page.evaluate((x) => window.bench.infer(x), probe)).inferMs)

    const scoring = !gpu || candidate.scoreAllEps === true // CPU is the reference; GPU gets a parity sample unless full scoring is requested
    const subset = scoring ? cases : cases.filter((c, i) => i % 40 === 0)
    const results = []
    for (const c of subset) {
      const r = await page.evaluate((i) => window.bench.infer(i), c.image)
      results.push({ image: c.image, group: c.group, label: c.label, phoneAreaRatio: c.phoneAreaRatio, scenario: c.scenario ?? null, score: r.score, box: r.box ?? null, inferMs: r.inferMs })
    }
    await page.evaluate(() => window.bench.release())
    return {
      candidate: candidate.id,
      model: candidate.model,
      runtime: candidate.runtime,
      ep,
      accelerator: loaded.accelerator ?? (gpu ? 'webgpu' : 'wasm (1 thread)'),
      objectBackend: loaded.objectBackend ?? null,
      webgpuAdapter: webgpu,
      modelBytes: statSync(join(cache, 'models', candidate.model)).size,
      coldStartMs: Math.round(loaded.loadMs + first.inferMs),
      loadMs: Math.round(loaded.loadMs),
      firstInferMs: Math.round(first.inferMs),
      steadyMedianMs: Math.round(median(steady)),
      steadyP90Ms: Math.round(p90(steady)),
      scoring: scoring ? 'full dataset' : 'parity sample',
      results,
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  const args = process.argv.slice(2)
  const datasetArg = args.find((a) => a.startsWith('--dataset='))
  const only = args.filter((a) => !a.startsWith('--'))
  const custom = datasetArg ? validationCases(datasetArg.slice('--dataset='.length)) : null
  const cases = custom ? custom.cases : datasetCases()
  const workerChunk = readdirSync(join(app, 'dist', 'assets')).find((f) => /^worker-.*\.js$/.test(f))
  if (!workerChunk) throw new Error('dist/ has no worker chunk — run `npm run build` first')
  const server = serve(cases)
  const outDir = custom ? join(here, 'results', custom.name) : join(here, 'results')
  mkdirSync(outDir, { recursive: true })
  try {
    for (const candidate of CANDIDATES.filter((c) => only.length === 0 || only.includes(c.id))) {
      if (!existsSync(join(cache, 'models', candidate.model))) {
        console.log(`[models] ${candidate.id}: model file missing, skipped`)
        continue
      }
      for (const ep of candidate.eps) {
        const started = Date.now()
        let outcome
        try {
          outcome = await evaluate(candidate, ep, cases, workerChunk)
        } catch (error) {
          outcome = { candidate: candidate.id, ep, error: String(error.message ?? error).slice(0, 400) }
        }
        writeFileSync(join(outDir, `${candidate.id}.${ep}.json`), JSON.stringify(outcome, null, 1))
        const summary = outcome.error ?? outcome.unavailable ?? `cold ${outcome.coldStartMs} ms, steady ${outcome.steadyMedianMs} ms (p90 ${outcome.steadyP90Ms}), ${outcome.results.length} images`
        console.log(`[models] ${candidate.id} / ${ep}: ${summary} (${Math.round((Date.now() - started) / 1000)} s)`)
      }
    }
  } finally {
    server.close()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[models]', error.message)
    process.exit(1)
  })
}
