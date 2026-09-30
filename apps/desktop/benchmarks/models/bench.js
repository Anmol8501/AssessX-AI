// Browser side of the object-detector evaluation (Phase 5B). Loaded by run.mjs into Microsoft Edge.
// Each model gets the preprocessing and score semantics of its official reference implementation,
// and reports the single highest "cell phone" score per image (no threshold is applied here).
import * as ort from '/ort/ort.webgpu.min.mjs'

ort.env.wasm.wasmPaths = '/ort/'
// The app's WebView is not cross-origin isolated, so WebAssembly runs single-threaded there too.
ort.env.wasm.numThreads = 1

const at = (p) => new URL(p, location.origin).toString()
let current = null

async function bitmapFor(image) {
  if (image.startsWith('synthetic:')) {
    const canvas = new OffscreenCanvas(640, 480)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = image.slice('synthetic:'.length)
    ctx.fillRect(0, 0, 640, 480)
    return canvas.transferToImageBitmap()
  }
  return createImageBitmap(await (await fetch(`/img/${encodeURIComponent(image)}`)).blob())
}

// ---------------------------------------------------------------- MediaPipe (the app's own worker)
function reply(worker, timeoutMs) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ type: 'TIMEOUT' }), timeoutMs)
    worker.onmessage = (e) => {
      clearTimeout(t)
      resolve(e.data)
    }
    worker.onerror = (e) => {
      clearTimeout(t)
      resolve({ type: 'worker-error', error: e.message })
    }
  })
}

const mediapipe = {
  // `objectModel: 'yolox_tiny'` exercises the app's own YOLOX-Tiny integration (production path).
  async load({ workerChunk, model, gpu, objectModel = 'efficientdet_lite0', yoloxSha256 }) {
    const worker = new Worker(`/app/assets/${workerChunk}`, { type: 'module' })
    const started = performance.now()
    const loaded = reply(worker, 120000)
    worker.postMessage({
      type: 'load',
      config: {
        wasmLoaderPath: at('/app/mediapipe/wasm/vision_wasm_module_internal.js'),
        wasmBinaryPath: at('/app/mediapipe/wasm/vision_wasm_module_internal.wasm'),
        // Only the object detector is evaluated; the face tasks are deliberately not loaded.
        models: { faceDetector: at('/models/__none__'), faceLandmarker: at('/models/__none__'), objectDetector: at(`/models/${model}`) },
        preferGpu: gpu,
        objectCategories: ['cell phone'],
        landmarkerMaxFaces: 1,
        objectModel,
        yolox: { modelUrl: at(`/models/${model}`), sha256: yoloxSha256 ?? '', wasmPaths: at('/ort-runtime/'), preferWebGPU: gpu, warmupTimeoutMs: 30000 },
      },
    })
    const result = await loaded
    if (result.type !== 'loaded' || result.tasks.objectDetector !== 'READY') throw new Error(`MediaPipe load failed: ${JSON.stringify(result)}`)
    current = { kind: 'mediapipe', worker, next: 1 }
    return { loadMs: performance.now() - started, accelerator: result.objectBackend?.accelerator ?? result.accelerator, objectBackend: result.objectBackend ?? null }
  },
  async infer(image) {
    const bitmap = await bitmapFor(image)
    const id = current.next++
    const started = performance.now()
    const pending = reply(current.worker, 60000)
    current.worker.postMessage({ type: 'infer', id, timestampMs: id * 100, bitmap }, [bitmap])
    const r = await pending
    if (r.type !== 'result') throw new Error(`inference failed: ${r.type} ${r.error ?? ''}`)
    const top = r.payload.objects?.[0] ?? null
    return { score: top?.score ?? 0, box: top?.box ?? null, inferMs: r.payload.timingsMs.objectDetector, roundTripMs: performance.now() - started }
  },
}

// ------------------------------------------------------------------------------ ONNX adapters
const ADAPTERS = {
  // YOLOX (official demo/ONNXRuntime/onnx_inference.py): top-left letterbox, pad 114, BGR, 0..255,
  // NCHW; output [1, N, 85] = box(4), objectness, 80 COCO class scores (sigmoid applied in export).
  // Score for a class = objectness × class probability. COCO-80 index 67 = cell phone.
  yolox: {
    prepare(bitmap, size) {
      const canvas = new OffscreenCanvas(size, size)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.fillStyle = 'rgb(114,114,114)'
      ctx.fillRect(0, 0, size, size)
      const r = Math.min(size / bitmap.height, size / bitmap.width)
      ctx.drawImage(bitmap, 0, 0, Math.round(bitmap.width * r), Math.round(bitmap.height * r))
      const { data } = ctx.getImageData(0, 0, size, size)
      const plane = size * size
      const tensor = new Float32Array(3 * plane)
      for (let i = 0; i < plane; i++) {
        tensor[i] = data[i * 4 + 2] // B
        tensor[plane + i] = data[i * 4 + 1] // G
        tensor[2 * plane + i] = data[i * 4] // R
      }
      return { [current.session.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, size, size]) }
    },
    score(outputs) {
      const out = outputs[current.session.outputNames[0]]
      const [, n, stride] = out.dims
      let best = 0
      for (let i = 0; i < n; i++) best = Math.max(best, out.data[i * stride + 4] * out.data[i * stride + 5 + 67])
      return best
    },
  },
  // D-FINE (official tools/deployment/export_onnx.py, postprocessor included): RGB, resized to
  // 640×640, scaled to 0..1; outputs labels/boxes/scores for the top 300 queries. Labels are the
  // contiguous COCO-80 indices (67 = cell phone) — D-FINE remaps to COCO category ids only in its
  // evaluation code, not in the exported post-processor (verified on real phone images).
  dfine: {
    prepare(bitmap, size) {
      const canvas = new OffscreenCanvas(size, size)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(bitmap, 0, 0, size, size)
      const { data } = ctx.getImageData(0, 0, size, size)
      const plane = size * size
      const tensor = new Float32Array(3 * plane)
      for (let i = 0; i < plane; i++) {
        tensor[i] = data[i * 4] / 255
        tensor[plane + i] = data[i * 4 + 1] / 255
        tensor[2 * plane + i] = data[i * 4 + 2] / 255
      }
      return {
        images: new ort.Tensor('float32', tensor, [1, 3, size, size]),
        orig_target_sizes: new ort.Tensor('int64', BigInt64Array.from([BigInt(bitmap.width), BigInt(bitmap.height)]), [1, 2]),
      }
    },
    score(outputs) {
      const labels = outputs.labels.data
      const scores = outputs.scores.data
      let best = 0
      for (let i = 0; i < scores.length; i++) if (Number(labels[i]) === current.phoneLabel) best = Math.max(best, scores[i])
      return best
    },
  },
}

const onnx = {
  async load({ model, adapter, size, ep, phoneLabel }) {
    const started = performance.now()
    const session = await ort.InferenceSession.create(`/models/${model}`, { executionProviders: [ep], graphOptimizationLevel: 'all' })
    current = { kind: 'onnx', session, adapter: ADAPTERS[adapter], size, phoneLabel }
    return { loadMs: performance.now() - started, inputs: session.inputNames, outputs: session.outputNames }
  },
  async infer(image) {
    const bitmap = await bitmapFor(image)
    const p0 = performance.now()
    const feeds = current.adapter.prepare(bitmap, current.size)
    const p1 = performance.now()
    const outputs = await current.session.run(feeds)
    const p2 = performance.now()
    const score = current.adapter.score(outputs)
    for (const t of Object.values(outputs)) t.dispose?.()
    bitmap.close()
    return { score, inferMs: p2 - p1, preprocessMs: p1 - p0 }
  },
}

window.bench = {
  webgpu: async () => {
    if (!navigator.gpu) return null
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return null
    const info = adapter.info ?? {}
    return { vendor: info.vendor, architecture: info.architecture, description: info.description }
  },
  load: (spec) => (spec.runtime === 'mediapipe' ? mediapipe.load(spec) : onnx.load(spec)),
  infer: (image) => (current.kind === 'mediapipe' ? mediapipe.infer(image) : onnx.infer(image)),
  async release() {
    if (current?.kind === 'mediapipe') current.worker.terminate()
    if (current?.kind === 'onnx') await current.session.release()
    current = null
  },
}
