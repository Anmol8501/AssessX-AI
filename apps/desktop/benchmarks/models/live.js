// Live webcam comparison page (Phase 5B model evaluation). Every camera frame is scored by every
// candidate: EfficientDet-Lite0 through the app's own MediaPipe worker (CPU), and the ONNX models
// through ONNX Runtime WebGPU. Only numbers are kept — no frame is stored or sent anywhere.
import * as ort from '/ort/ort.webgpu.min.mjs'

ort.env.wasm.wasmPaths = '/ort/'
ort.env.wasm.numThreads = 1
const at = (p) => new URL(p, location.origin).toString()

function yoloxFeeds(bitmap, size, session) {
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = 'rgb(114,114,114)'
  ctx.fillRect(0, 0, size, size)
  const r = Math.min(size / bitmap.height, size / bitmap.width)
  ctx.drawImage(bitmap, 0, 0, Math.round(bitmap.width * r), Math.round(bitmap.height * r))
  const { data } = ctx.getImageData(0, 0, size, size)
  const plane = size * size
  const t = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    t[i] = data[i * 4 + 2]
    t[plane + i] = data[i * 4 + 1]
    t[2 * plane + i] = data[i * 4]
  }
  return { [session.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, size, size]) }
}
function yoloxScore(outputs, session) {
  const out = outputs[session.outputNames[0]]
  const [, n, stride] = out.dims
  let best = 0
  for (let i = 0; i < n; i++) best = Math.max(best, out.data[i * stride + 4] * out.data[i * stride + 5 + 67])
  return best
}
function dfineFeeds(bitmap, size) {
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)
  const plane = size * size
  const t = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    t[i] = data[i * 4] / 255
    t[plane + i] = data[i * 4 + 1] / 255
    t[2 * plane + i] = data[i * 4 + 2] / 255
  }
  return {
    images: new ort.Tensor('float32', t, [1, 3, size, size]),
    orig_target_sizes: new ort.Tensor('int64', BigInt64Array.from([BigInt(bitmap.width), BigInt(bitmap.height)]), [1, 2]),
  }
}
function dfineScore(outputs) {
  let best = 0
  for (let i = 0; i < outputs.scores.data.length; i++) if (Number(outputs.labels.data[i]) === 67) best = Math.max(best, outputs.scores.data[i])
  return best
}

const ONNX = [
  { id: 'yolox-tiny', model: 'yolox_tiny.onnx', size: 416, feeds: yoloxFeeds, score: yoloxScore },
  { id: 'yolox-s', model: 'yolox_s.onnx', size: 640, feeds: yoloxFeeds, score: yoloxScore },
  { id: 'dfine-n', model: 'dfine_n_coco.onnx', size: 640, feeds: dfineFeeds, score: dfineScore },
]

const state = { records: [], status: 'starting', running: false }
window.live = state

async function start(workerChunk) {
  state.status = 'opening camera'
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  video.style.cssText = 'width:480px;border-radius:8px'
  document.body.appendChild(video)
  await video.play()

  state.status = 'loading models'
  const worker = new Worker(`/app/assets/${workerChunk}`, { type: 'module' })
  const mpReply = () => new Promise((resolve) => (worker.onmessage = (e) => resolve(e.data)))
  let pending = mpReply()
  worker.postMessage({
    type: 'load',
    config: {
      wasmLoaderPath: at('/app/mediapipe/wasm/vision_wasm_module_internal.js'),
      wasmBinaryPath: at('/app/mediapipe/wasm/vision_wasm_module_internal.wasm'),
      models: { faceDetector: at('/models/__none__'), faceLandmarker: at('/models/__none__'), objectDetector: at('/models/efficientdet_lite0.tflite') },
      preferGpu: false,
      objectCategories: ['cell phone'],
      landmarkerMaxFaces: 1,
    },
  })
  await pending
  for (const m of ONNX) m.session = await ort.InferenceSession.create(`/models/${m.model}`, { executionProviders: ['webgpu'] })

  let id = 1
  const frame = async (record) => {
    const t = performance.now()
    const forWorker = await createImageBitmap(video)
    pending = mpReply()
    worker.postMessage({ type: 'infer', id: id++, timestampMs: t, bitmap: forWorker }, [forWorker])
    const bitmap = await createImageBitmap(video)
    const scores = {}
    for (const m of ONNX) {
      const outputs = await m.session.run(m.feeds(bitmap, m.size, m.session))
      scores[m.id] = m.score(outputs, m.session)
      for (const o of Object.values(outputs)) o.dispose?.()
    }
    bitmap.close()
    const r = await pending
    scores['efficientdet-lite0'] = r.type === 'result' ? (r.payload.objects?.[0]?.score ?? 0) : null
    if (record) state.records.push({ t, scores })
  }
  state.status = 'warming up'
  for (let i = 0; i < 3; i++) await frame(false) // shader compilation / first-inference warm-up
  state.status = 'ready'
  state.running = true
  while (state.running) await frame(true)
  worker.terminate()
  stream.getTracks().forEach((track) => track.stop())
  state.status = 'stopped'
}
window.startLive = start

// ------------------------------------------------------------------------------------------------
// Production mode: both object models through the app's own AI worker (EfficientDet-Lite0 and the
// integrated YOLOX-Tiny), each in its own worker, scoring the same frames. Numbers only.
async function startProduction(workerChunk) {
  state.status = 'opening camera'
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  video.style.cssText = 'width:480px;border-radius:8px'
  document.body.appendChild(video)
  await video.play()

  state.status = 'loading models'
  const makeWorker = async (objectModel, model) => {
    const worker = new Worker(`/app/assets/${workerChunk}`, { type: 'module' })
    const reply = () => new Promise((resolve) => (worker.onmessage = (e) => resolve(e.data)))
    const loaded = reply()
    worker.postMessage({
      type: 'load',
      config: {
        wasmLoaderPath: at('/app/mediapipe/wasm/vision_wasm_module_internal.js'),
        wasmBinaryPath: at('/app/mediapipe/wasm/vision_wasm_module_internal.wasm'),
        models: { faceDetector: at('/models/__none__'), faceLandmarker: at('/models/__none__'), objectDetector: at(`/models/${model}`) },
        preferGpu: false,
        objectCategories: ['cell phone'],
        landmarkerMaxFaces: 1,
        objectModel,
        yolox: { modelUrl: at(`/models/${model}`), sha256: '427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7', wasmPaths: at('/ort-runtime/'), preferWebGPU: true, warmupTimeoutMs: 30000 },
      },
    })
    const result = await loaded
    return { worker, reply, backend: result.objectBackend }
  }
  const workers = {
    'efficientdet-lite0': await makeWorker('efficientdet_lite0', 'efficientdet_lite0.tflite'),
    'yolox-tiny': await makeWorker('yolox_tiny', 'yolox_tiny.onnx'),
  }
  state.backends = Object.fromEntries(Object.entries(workers).map(([k, w]) => [k, w.backend]))

  let id = 1
  const frame = async (record) => {
    const t = performance.now()
    const pending = await Promise.all(
      Object.entries(workers).map(async ([name, w]) => {
        const bitmap = await createImageBitmap(video)
        const reply = w.reply()
        w.worker.postMessage({ type: 'infer', id: id++, timestampMs: t, bitmap }, [bitmap])
        const r = await reply
        return [name, r.type === 'result' ? (r.payload.objects?.[0]?.score ?? 0) : null]
      }),
    )
    if (record) state.records.push({ t, scores: Object.fromEntries(pending) })
  }
  state.status = 'warming up'
  for (let i = 0; i < 3; i++) await frame(false)
  state.status = 'ready'
  state.running = true
  while (state.running) await frame(true)
  Object.values(workers).forEach((w) => w.worker.terminate())
  stream.getTracks().forEach((track) => track.stop())
  state.status = 'stopped'
}
window.startProductionLive = startProduction
