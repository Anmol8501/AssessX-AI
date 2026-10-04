import type * as Ort from 'onnxruntime-web/webgpu'
import type { DetectedObject, ObjectBackendReport, YoloxLoadConfig } from '../mediapipe/protocol'
import { OBJECT_CLASSES, YOLOX_SPECS, yoloxAttempts, type ObjectModelId, type YoloxSpec } from './models'
import { mergeRegions, pixelRect, toFrame, type Region } from './tiling'
import { decodeClasses, letterbox, nms, toBgrTensor, type Candidate } from './yolox'

/** Scores below this are dropped while decoding — a performance floor far below every threshold. */
const DECODE_FLOOR = 0.01
/** Candidates kept per class after merging regions. */
const PER_CLASS = 3

/**
 * YOLOX object detection through ONNX Runtime Web, inside the AI worker.
 *
 *   * **Model and backend, in order** (`yoloxAttempts`): for the default `yolox` mode, YOLOX-S on
 *     WebGPU, else YOLOX-Tiny on WebGPU, else YOLOX-Tiny on WebAssembly. WebGPU is accepted only after
 *     a warm-up inference succeeds in time. What was used, and why anything was skipped, is reported.
 *   * **Integrity first.** Each model file is fetched and its SHA-256 compared with the pinned digest
 *     before use; a missing or altered file fails that attempt with a clear reason.
 *   * **Every reported class** (phone, book, laptop, remote) is decoded from the same inference.
 *   * **Regions** (see `tiling.ts`): the whole frame and/or zoomed tiles, merged per class.
 *   * **No decision here.** Candidates carry raw model confidence; the event layer applies thresholds.
 */
export class YoloxBackend {
  private readonly ort: typeof Ort
  private readonly session: Ort.InferenceSession
  private readonly spec: YoloxSpec
  private canvas: OffscreenCanvas | null = null
  readonly report: ObjectBackendReport

  private constructor(ort: typeof Ort, session: Ort.InferenceSession, spec: YoloxSpec, report: ObjectBackendReport) {
    this.ort = ort
    this.session = session
    this.spec = spec
    this.report = report
  }

  get provider(): 'webgpu' | 'wasm' {
    return this.report.accelerator === 'webgpu' ? 'webgpu' : 'wasm'
  }

  static async create(mode: ObjectModelId, config: YoloxLoadConfig): Promise<YoloxBackend> {
    // Loaded only when a YOLOX mode is selected, so other builds never run ONNX Runtime.
    const ort = await import('onnxruntime-web/webgpu')
    ort.env.wasm.wasmPaths = config.wasmPaths
    ort.env.wasm.numThreads = 1 // the app's WebView is not cross-origin isolated
    ort.env.wasm.proxy = false

    const gpu = config.preferWebGPU && (await hasGpuAdapter())
    const attempts = yoloxAttempts(mode, gpu)
    if (attempts.length === 0) throw new Error(`"${mode}" is not a YOLOX mode`)
    const skipped: string[] = config.preferWebGPU && !gpu ? ['WebGPU adapter not available'] : []
    const bytes = new Map<string, Uint8Array>()

    for (const { model, provider } of attempts) {
      const spec = YOLOX_SPECS[model]
      let session: Ort.InferenceSession | null = null
      const started = performance.now()
      try {
        let file = bytes.get(model)
        if (!file) {
          file = await fetchVerified(config.models[model].url, config.models[model].sha256, spec)
          bytes.set(model, file)
        }
        session = await ort.InferenceSession.create(file, { executionProviders: [provider], graphOptimizationLevel: 'all' })
        checkSignature(session, spec)
        const report: ObjectBackendReport = {
          model,
          accelerator: provider,
          loadMs: performance.now() - started,
          warmupMs: null,
          firstInferenceMs: null,
          fallback: skipped.length ? skipped.join(' | ') : null,
        }
        const backend = new YoloxBackend(ort, session, spec, report)
        const blank = new ort.Tensor('float32', new Float32Array(3 * spec.size * spec.size).fill(spec.padValue), [...spec.input.shape])
        const warmupStarted = performance.now()
        await withTimeout(backend.run(blank), provider === 'webgpu' ? config.warmupTimeoutMs : Number.POSITIVE_INFINITY, 'warm-up timed out')
        report.warmupMs = performance.now() - warmupStarted
        const firstStarted = performance.now()
        await backend.run(blank)
        report.firstInferenceMs = performance.now() - firstStarted
        return backend
      } catch (error) {
        await session?.release().catch(() => undefined)
        skipped.push(`${model}/${provider}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    // Every attempt's cause is kept: the first failure is usually the informative one.
    throw new Error(`No YOLOX model could run — ${skipped.join(' | ')}`)
  }

  /**
   * The most confident candidates of every reported class in the given regions of the frame, in the
   * frame's own normalised coordinates (`PER_CLASS` per class at most, merged across regions).
   */
  async detect(bitmap: ImageBitmap, regions: readonly Region[]): Promise<DetectedObject[]> {
    const indices = OBJECT_CLASSES.map((c) => c.cocoIndex)
    const all = new Map<number, (Candidate & { region: 'full' | 'tile' })[]>(indices.map((i) => [i, []]))
    for (const region of regions) {
      const found = await this.detectRegion(bitmap, region, indices)
      const kind = region.width >= 1 && region.height >= 1 ? 'full' : 'tile'
      for (const [classIndex, candidates] of found) {
        for (const c of candidates) all.get(classIndex)!.push({ score: c.score, box: toFrame(c.box, region), region: kind })
      }
    }
    const objects: DetectedObject[] = []
    for (const cls of OBJECT_CLASSES) {
      const merged = mergeRegions(all.get(cls.cocoIndex) ?? [], this.spec.nmsIou, PER_CLASS) as (Candidate & { region: 'full' | 'tile' })[]
      for (const c of merged) objects.push({ category: cls.label, score: c.score, box: c.box, region: c.region })
    }
    return objects
  }

  async release(): Promise<void> {
    await this.session.release()
    this.canvas = null
  }

  private async detectRegion(bitmap: ImageBitmap, region: Region, indices: number[]): Promise<Map<number, Candidate[]>> {
    const spec = this.spec
    const { sx, sy, sw, sh } = pixelRect(region, bitmap.width, bitmap.height)
    const placement = letterbox(sw, sh, spec.size)
    if (!this.canvas || this.canvas.width !== spec.size) this.canvas = new OffscreenCanvas(spec.size, spec.size)
    const context = this.canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('2D canvas unavailable for YOLOX preprocessing')
    context.fillStyle = `rgb(${spec.padValue},${spec.padValue},${spec.padValue})`
    context.fillRect(0, 0, spec.size, spec.size)
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, placement.width, placement.height)
    const pixels = context.getImageData(0, 0, spec.size, spec.size).data
    context.clearRect(0, 0, spec.size, spec.size) // the preprocessed copy is not kept
    const input = new this.ort.Tensor('float32', toBgrTensor(pixels, spec.size), [...spec.input.shape])
    const output = await this.run(input)
    const decoded = decodeClasses(output, spec.output.shape[2], indices, spec.strides, placement, sw, sh, DECODE_FLOOR)
    const result = new Map<number, Candidate[]>()
    for (const [classIndex, candidates] of decoded) result.set(classIndex, nms(candidates, spec.nmsIou, PER_CLASS))
    return result
  }

  private async run(input: Ort.Tensor): Promise<Float32Array> {
    const results = await this.session.run({ [this.spec.input.name]: input })
    const output = results[this.spec.output.name]
    if (!output) throw new Error(`${this.spec.id} produced no output`)
    const data = (await output.getData()) as Float32Array
    output.dispose() // release any GPU buffer; CPU input tensors need no explicit release
    return data
  }
}

async function fetchVerified(url: string, expected: string, spec: YoloxSpec): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${spec.id} model missing (HTTP ${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const digest = await sha256Hex(bytes)
  if (digest !== expected) throw new Error(`${spec.id} model failed its integrity check (SHA-256 ${digest.slice(0, 12)}…)`)
  return bytes
}

function checkSignature(session: Ort.InferenceSession, spec: YoloxSpec): void {
  if (!session.inputNames.includes(spec.input.name) || !session.outputNames.includes(spec.output.name)) {
    throw new Error(`Unexpected ${spec.id} model signature (inputs ${session.inputNames.join(',')}; outputs ${session.outputNames.join(',')})`)
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
