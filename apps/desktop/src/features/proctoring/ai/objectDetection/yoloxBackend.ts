import type * as Ort from 'onnxruntime-web/webgpu'
import type { DetectedObject, ObjectBackendReport, YoloxLoadConfig } from '../mediapipe/protocol'
import { YOLOX_TINY } from './models'
import { decodeClass, letterbox, nms, toBgrTensor } from './yolox'

/**
 * YOLOX-Tiny object detection through ONNX Runtime Web, running inside the AI worker (Phase 5B,
 * opt-in). It returns the same `DetectedObject[]` the MediaPipe object detector returns, so the
 * `PhoneDetector` and everything downstream are unchanged.
 *
 *   * **Integrity first.** The model file is fetched and its SHA-256 compared with the pinned digest
 *     before it is used; a missing or altered file fails the load with a clear reason.
 *   * **WebGPU when it actually works, else WebAssembly.** WebGPU is tried only if the worker has a
 *     GPU adapter, and is accepted only after a warm-up inference succeeds in time; otherwise the
 *     WebAssembly (CPU) backend is used. The path taken is reported, never assumed.
 *   * **Cold start separated from steady state.** Loading, the warm-up inference (kernel/shader
 *     compilation) and the first post-warm-up inference are timed separately.
 *   * **No threshold.** Only the most confident phone candidate after NMS is returned.
 */
export class YoloxBackend {
  private readonly ort: typeof Ort
  private readonly session: Ort.InferenceSession
  private canvas: OffscreenCanvas | null = null
  readonly report: ObjectBackendReport

  private constructor(ort: typeof Ort, session: Ort.InferenceSession, report: ObjectBackendReport) {
    this.ort = ort
    this.session = session
    this.report = report
  }

  static async create(config: YoloxLoadConfig): Promise<YoloxBackend> {
    // Loaded only when YOLOX is selected, so the default build never runs ONNX Runtime.
    const ort = await import('onnxruntime-web/webgpu')
    ort.env.wasm.wasmPaths = config.wasmPaths
    ort.env.wasm.numThreads = 1 // the app's WebView is not cross-origin isolated
    ort.env.wasm.proxy = false

    const started = performance.now()
    const response = await fetch(config.modelUrl)
    if (!response.ok) throw new Error(`YOLOX-Tiny model missing (HTTP ${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const digest = await sha256Hex(bytes)
    if (digest !== config.sha256) throw new Error(`YOLOX-Tiny model failed its integrity check (SHA-256 ${digest.slice(0, 12)}…)`)
    const fetchMs = performance.now() - started

    const attempts: ('webgpu' | 'wasm')[] = config.preferWebGPU && (await hasGpuAdapter()) ? ['webgpu', 'wasm'] : ['wasm']
    let fallback: string | null = config.preferWebGPU && attempts.length === 1 ? 'WebGPU adapter not available' : null
    const failures: string[] = []
    for (const provider of attempts) {
      const createStarted = performance.now()
      let session: Ort.InferenceSession | null = null
      try {
        session = await ort.InferenceSession.create(bytes, { executionProviders: [provider], graphOptimizationLevel: 'all' })
        checkSignature(session)
        const loadMs = fetchMs + (performance.now() - createStarted)
        const backend = new YoloxBackend(ort, session, { model: 'yolox_tiny', accelerator: provider, loadMs, warmupMs: null, firstInferenceMs: null, fallback })
        const blank = new ort.Tensor('float32', new Float32Array(3 * YOLOX_TINY.size * YOLOX_TINY.size).fill(YOLOX_TINY.padValue), [...YOLOX_TINY.input.shape])
        const warmupStarted = performance.now()
        await withTimeout(backend.run(blank), provider === 'webgpu' ? config.warmupTimeoutMs : Number.POSITIVE_INFINITY, 'warm-up timed out')
        backend.report.warmupMs = performance.now() - warmupStarted
        const firstStarted = performance.now()
        await backend.run(blank)
        backend.report.firstInferenceMs = performance.now() - firstStarted
        return backend
      } catch (error) {
        await session?.release().catch(() => undefined)
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`${provider}: ${message}`)
        if (provider === 'webgpu') fallback = `WebGPU rejected: ${message}`
      }
    }
    // Every attempt's cause is kept: the first failure is usually the informative one.
    throw new Error(`No ONNX Runtime backend could run YOLOX-Tiny — ${failures.join(' | ')}`)
  }

  /** Most confident phone candidate(s) in the frame, in the frame's own normalised coordinates. */
  async detect(bitmap: ImageBitmap, maxResults = 1): Promise<DetectedObject[]> {
    const size = YOLOX_TINY.size
    const placement = letterbox(bitmap.width, bitmap.height, size)
    if (!this.canvas) this.canvas = new OffscreenCanvas(size, size)
    const context = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas unavailable for YOLOX preprocessing')
    context.fillStyle = `rgb(${YOLOX_TINY.padValue},${YOLOX_TINY.padValue},${YOLOX_TINY.padValue})`
    context.fillRect(0, 0, size, size)
    context.drawImage(bitmap, 0, 0, placement.width, placement.height)
    const pixels = context.getImageData(0, 0, size, size).data
    context.clearRect(0, 0, size, size) // the preprocessed copy is not kept
    const input = new this.ort.Tensor('float32', toBgrTensor(pixels, size), [...YOLOX_TINY.input.shape])
    const output = await this.run(input)
    const candidates = decodeClass(output, YOLOX_TINY.output.shape[2], YOLOX_TINY.classIndex, YOLOX_TINY.strides, placement, bitmap.width, bitmap.height)
    return nms(candidates, YOLOX_TINY.nmsIou, maxResults).map((c) => ({ category: YOLOX_TINY.classLabel, score: c.score, box: c.box }))
  }

  async release(): Promise<void> {
    await this.session.release()
    this.canvas = null
  }

  private async run(input: Ort.Tensor): Promise<Float32Array> {
    const results = await this.session.run({ [YOLOX_TINY.input.name]: input })
    const output = results[YOLOX_TINY.output.name]
    if (!output) throw new Error('YOLOX-Tiny produced no output')
    const data = (await output.getData()) as Float32Array
    output.dispose() // release any GPU buffer; CPU input tensors need no explicit release
    return data
  }
}

function checkSignature(session: Ort.InferenceSession): void {
  if (!session.inputNames.includes(YOLOX_TINY.input.name) || !session.outputNames.includes(YOLOX_TINY.output.name)) {
    throw new Error(`Unexpected YOLOX-Tiny model signature (inputs ${session.inputNames.join(',')}; outputs ${session.outputNames.join(',')})`)
  }
}

async function hasGpuAdapter(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return gpu !== undefined && (await gpu.requestAdapter()) !== null
  } catch {
    return false
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (!Number.isFinite(ms)) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
