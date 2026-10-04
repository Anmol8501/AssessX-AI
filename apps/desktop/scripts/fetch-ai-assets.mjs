// Prepares the on-device AI assets for Phase 5B (run automatically before `dev` and `build`).
//
// The exam must never depend on a CDN, so the MediaPipe runtime and its models are served from the
// app itself (`public/`), and end up inside the packaged installer. They are *not* committed:
//
//   * The WebAssembly runtime is copied from the installed `@mediapipe/tasks-vision` package, so it
//     always matches the version pinned in package.json / package-lock.json. Only the ES-module
//     variant is copied — it is what a module Web Worker loads, and it assumes SIMD, which every
//     WebView2 (Chromium) supports.
//   * The models are downloaded once from Google's published MediaPipe model storage and verified
//     against the SHA-256 digests below. A mismatch fails the build rather than shipping an
//     unverified model.
//
// Object models (product-owner decision, 2026-10-02): the default `yolox` mode ships YOLOX-S (used
// on WebGPU) and YOLOX-Tiny (the CPU fallback), SHA-256-verified and cached in .ai-cache/, plus ONNX
// Runtime Web's WebAssembly. EfficientDet-Lite0 always ships too (small; selectable for comparison).
//   * `--mode=dev` (predev: dev server and E2E tests) prepares every model;
//   * `--mode=build` (prebuild, also run by `tauri build`) includes the YOLOX models the build's
//     VITE_OBJECT_DETECTOR_MODEL needs (`yolox`: both; `yolox_s` / `yolox_tiny`: that one;
//     `efficientdet_lite0`: none, and no ONNX Runtime). An unknown value fails the build.
//
// This file is the provenance record for those models; docs/PHASE-5B-AI-DETECTORS.md explains them.

import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { loadEnv } from 'vite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public')
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models'

/** Pinned models. All are Google MediaPipe models published under Apache-2.0 (see their model cards). */
const MODELS = [
  {
    file: 'blaze_face_short_range.tflite',
    url: `${MODEL_BASE}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
    sha256: 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f',
  },
  {
    file: 'face_landmarker.task',
    url: `${MODEL_BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
  {
    file: 'efficientdet_lite0.tflite',
    url: `${MODEL_BASE}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
    sha256: '4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993',
  },
]

const WASM_FILES = ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']

/** YOLOX (Megvii-BaseDetection/YOLOX release 0.1.1rc0, commit e1052df7; Apache-2.0). */
const YOLOX_RELEASE = 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0'
const YOLOX = {
  yolox_s: {
    file: 'yolox_s.onnx',
    url: `${YOLOX_RELEASE}/yolox_s.onnx`,
    sha256: 'c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063',
  },
  yolox_tiny: {
    file: 'yolox_tiny.onnx',
    url: `${YOLOX_RELEASE}/yolox_tiny.onnx`,
    sha256: '427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7',
  },
}
/** Which YOLOX models each object-model mode needs. */
const YOLOX_NEEDED = { yolox: ['yolox_s', 'yolox_tiny'], yolox_s: ['yolox_s'], yolox_tiny: ['yolox_tiny'], efficientdet_lite0: [] }
/** ONNX Runtime Web files loaded at run time by the non-bundled WebGPU build (see vite.config.ts). */
// (onnxruntime-web 1.30's WebGPU build loads the "asyncify" runtime — checked in dist/ort.webgpu.min.mjs.)
const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']
const OBJECT_MODELS = Object.keys(YOLOX_NEEDED)

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function copyWasm() {
  const source = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
  const target = join(publicDir, 'mediapipe', 'wasm')
  await mkdir(target, { recursive: true })
  for (const file of WASM_FILES) {
    const from = join(source, file)
    if (!(await exists(from))) throw new Error(`MediaPipe runtime file missing: ${from} (run npm install)`)
    await copyFile(from, join(target, file))
  }
}

async function ensureModel({ file, url, sha256: expected }, dir = join(publicDir, 'models')) {
  const target = join(dir, file)
  if (await exists(target)) {
    if (sha256(await readFile(target)) === expected) return 'present'
    await rm(target) // stale or corrupt: fetch it again
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not download ${file}: HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  const actual = sha256(buffer)
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${file}: expected ${expected}, got ${actual}`)
  await mkdir(dirname(target), { recursive: true })
  const partial = `${target}.partial`
  await writeFile(partial, buffer)
  await rename(partial, target)
  return 'downloaded'
}

/** The object model a build/dev run uses, read the way Vite reads it (.env files + environment). */
function objectModel(mode) {
  const env = loadEnv(mode === 'build' ? 'production' : 'development', root, 'VITE_')
  const value = (env.VITE_OBJECT_DETECTOR_MODEL ?? '').trim() || 'yolox'
  if (!OBJECT_MODELS.includes(value)) {
    throw new Error(`VITE_OBJECT_DETECTOR_MODEL="${value}" is not one of ${OBJECT_MODELS.join(', ')}`)
  }
  return value
}

async function yoloxAssets(needed) {
  const ortTarget = join(publicDir, 'onnxruntime')
  const states = []
  for (const [id, spec] of Object.entries(YOLOX)) {
    const modelTarget = join(publicDir, 'models', spec.file)
    if (!needed.includes(id)) {
      await rm(modelTarget, { force: true })
      continue
    }
    const cached = await ensureModel(spec, join(root, '.ai-cache'))
    await copyFile(join(root, '.ai-cache', spec.file), modelTarget)
    states.push(`${id} ${cached}`)
  }
  if (needed.length === 0) {
    await rm(ortTarget, { recursive: true, force: true })
    return 'excluded'
  }
  await rm(ortTarget, { recursive: true, force: true }) // no stale runtime files from another version
  await mkdir(ortTarget, { recursive: true })
  const ortSource = join(root, 'node_modules', 'onnxruntime-web', 'dist')
  for (const file of ORT_FILES) {
    if (!(await exists(join(ortSource, file)))) throw new Error(`ONNX Runtime file missing: ${file} (run npm install)`)
    await copyFile(join(ortSource, file), join(ortTarget, file))
  }
  return `included (${states.join(', ')})`
}

try {
  const mode = process.argv.includes('--mode=build') ? 'build' : 'dev'
  const model = objectModel(mode)
  await copyWasm()
  const results = []
  for (const m of MODELS) results.push(`${m.file}: ${await ensureModel(m)}`)
  // Dev/test runs prepare every model; a build ships the YOLOX models its mode needs.
  const yolox = await yoloxAssets(mode === 'dev' ? YOLOX_NEEDED.yolox : YOLOX_NEEDED[model])
  console.log(`[ai-assets] ${mode}, object model ${model}; runtime copied; ${results.join(', ')}; YOLOX + ONNX Runtime: ${yolox}`)
} catch (error) {
  console.error(`[ai-assets] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
