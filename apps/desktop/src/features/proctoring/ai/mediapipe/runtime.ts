import type { AIRuntime, Frame, RawInference, RuntimeInfo, RuntimeState } from '../types'
import {
  assetUrls,
  INFERENCE_TIMEOUT_MS,
  LANDMARKER_MAX_FACES,
  LOAD_TIMEOUT_MS,
  OBJECT_CATEGORIES,
  PREFER_GPU,
  RUNTIME_VERSION,
  YOLOX_PREFER_WEBGPU,
  YOLOX_WARMUP_TIMEOUT_MS,
} from './config'
import { DEFAULT_OBJECT_MODEL, YOLOX_TINY, type ObjectModelId } from '../objectDetection/models'
import type { Accelerator, ObjectBackendReport, TaskName, WorkerRequest, WorkerResponse } from './protocol'

type WorkerFactory = () => Worker

const defaultWorker: WorkerFactory = () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

interface Pending {
  resolve(response: WorkerResponse): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * The production Phase 5B runtime: MediaPipe Tasks Vision running in a dedicated Web Worker
 * (implements the Phase 5A `AIRuntime`).
 *
 * * **Off the UI thread.** Inference never blocks the exam; each frame's bitmap is transferred to
 *   the worker, which closes it after inference.
 * * **Loaded once.** Models load in `load()` and are reused for every frame; `unload()` disposes them
 *   and terminates the worker, releasing the WebAssembly memory and any GPU context.
 * * **Honest state.** LOAD_FAILED if no task could load; READY/RUNNING otherwise (tasks that failed
 *   individually surface through their detectors). The accelerator actually in use is reported —
 *   GPU is never claimed on a CPU fallback.
 * * **No silent stalls.** An inference that does not return within `INFERENCE_TIMEOUT_MS` terminates
 *   the worker and puts the runtime in ERROR: a hung worker is reported, and frames can never queue
 *   up behind it (the scheduler keeps at most one frame in flight).
 */
export class MediaPipeRuntime implements AIRuntime {
  private _state: RuntimeState = 'UNINITIALIZED'
  private accelerator: Accelerator | null = null
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private loadPending: Pending | null = null
  private readonly createWorker: WorkerFactory
  private readonly origin: string | undefined
  /** The object model this runtime loads (read-only; set at construction). */
  readonly objectModel: ObjectModelId
  private readonly objectModelUrl: string | undefined
  /** How the object detector came up (model, accelerator, load/warm-up timings); null until loaded. */
  objectBackend: ObjectBackendReport | null = null
  /** Which tasks loaded; null until `load()` finishes. */
  taskAvailability: Record<TaskName, 'READY' | 'UNAVAILABLE'> | null = null
  loadErrors: string[] = []

  constructor(
    options: {
      createWorker?: WorkerFactory
      origin?: string
      /** Which object model the worker loads; EfficientDet-Lite0 unless explicitly configured. */
      objectModel?: ObjectModelId
      /** Test-only override of the YOLOX model URL (e.g. to exercise a missing model). */
      objectModelUrl?: string
    } = {},
  ) {
    this.createWorker = options.createWorker ?? defaultWorker
    this.origin = options.origin
    this.objectModel = options.objectModel ?? DEFAULT_OBJECT_MODEL
    this.objectModelUrl = options.objectModelUrl
  }

  get state(): RuntimeState {
    return this._state
  }

  get info(): RuntimeInfo {
    return {
      id: 'mediapipe-tasks-vision',
      version: RUNTIME_VERSION,
      kind: 'mediapipe',
      productionCapable: true,
      accelerator: this.accelerator,
      objectDetector: this.objectBackend,
      loadErrors: this.loadErrors,
    }
  }

  async load(): Promise<void> {
    this._state = 'INITIALIZING'
    let worker: Worker
    try {
      worker = this.createWorker()
    } catch (error) {
      this._state = 'LOAD_FAILED'
      throw error instanceof Error ? error : new Error(String(error))
    }
    this.worker = worker
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(event.data)
    worker.onerror = (event) => this.fail(`AI worker error: ${event.message || 'unknown'}`)
    worker.onmessageerror = () => this.fail('AI worker sent an unreadable message')

    this._state = 'LOADING_MODEL'
    const urls = assetUrls(this.origin ?? globalThis.location.origin)
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('AI model loading timed out')), LOAD_TIMEOUT_MS)
      this.loadPending = { resolve, reject, timer }
      this.post({
        type: 'load',
        config: {
          wasmLoaderPath: urls.wasmLoaderPath,
          wasmBinaryPath: urls.wasmBinaryPath,
          models: urls.models,
          preferGpu: PREFER_GPU,
          objectCategories: OBJECT_CATEGORIES,
          landmarkerMaxFaces: LANDMARKER_MAX_FACES,
          objectModel: this.objectModel,
          yolox: {
            modelUrl: this.objectModelUrl ?? urls.yoloxModel,
            sha256: YOLOX_TINY.sha256,
            wasmPaths: urls.ortWasmPaths,
            preferWebGPU: YOLOX_PREFER_WEBGPU,
            warmupTimeoutMs: YOLOX_WARMUP_TIMEOUT_MS,
          },
        },
      })
    }).catch((error: unknown) => {
      this.terminate()
      this._state = 'LOAD_FAILED'
      throw error instanceof Error ? error : new Error(String(error))
    })

    if (response.type !== 'loaded') {
      this.terminate()
      this._state = 'LOAD_FAILED'
      throw new Error(response.type === 'load-failed' ? response.error : 'Unexpected AI worker response')
    }
    this.taskAvailability = response.tasks
    this.loadErrors = response.errors
    this.objectBackend = response.objectBackend
    this.accelerator = response.accelerator
    this._state = 'READY'
  }

  async infer(frame: Frame): Promise<RawInference> {
    if (this._state !== 'READY' && this._state !== 'RUNNING') {
      throw new Error(`AI runtime is not ready (${this._state})`)
    }
    const bitmap = frame.bitmap
    if (!bitmap) throw new Error('Frame has no pixel data') // malformed frame: no observation, not "nothing seen"
    this._state = 'RUNNING'
    const id = this.nextId++
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.fail('AI inference stopped responding')
        reject(new Error('AI inference timed out'))
      }, INFERENCE_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      // Transferred, not copied: the page no longer holds these pixels; the worker closes them.
      this.post({ type: 'infer', id, timestampMs: frame.monotonicTs, bitmap }, [bitmap])
    })
    if (response.type === 'result') {
      return {
        frameId: frame.frameId,
        monotonicTs: frame.monotonicTs,
        payload: response.payload,
        timingsMs: response.payload.timingsMs,
      }
    }
    throw new Error(response.type === 'infer-failed' ? response.error : 'Unexpected AI worker response')
  }

  async unload(): Promise<void> {
    if (this._state === 'STOPPED') return
    this._state = 'STOPPING'
    const worker = this.worker
    if (worker) {
      // Ask the worker to close its MediaPipe tasks, but never wait long: terminate regardless.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000)
        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === 'disposed') {
            clearTimeout(timer)
            worker.removeEventListener('message', onMessage)
            resolve()
          }
        }
        worker.addEventListener('message', onMessage)
        this.post({ type: 'dispose' })
      })
    }
    this.terminate()
    this._state = 'STOPPED'
  }

  private post(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer)
  }

  private onMessage(response: WorkerResponse): void {
    if (response.type === 'loaded' || response.type === 'load-failed') {
      const pending = this.loadPending
      this.loadPending = null
      if (pending) {
        clearTimeout(pending.timer)
        pending.resolve(response)
      }
      return
    }
    if (response.type === 'result' || response.type === 'infer-failed') {
      const pending = this.pending.get(response.id)
      if (!pending) return // timed out already
      this.pending.delete(response.id)
      clearTimeout(pending.timer)
      pending.resolve(response)
    }
  }

  /** A fatal worker problem: report ERROR honestly, release everything, reject whatever waits. */
  private fail(reason: string): void {
    if (this._state === 'STOPPING' || this._state === 'STOPPED') return
    this.terminate(new Error(reason))
    this._state = this._state === 'LOADING_MODEL' || this._state === 'INITIALIZING' ? 'LOAD_FAILED' : 'ERROR'
  }

  private terminate(reason = new Error('AI runtime stopped')): void {
    this.worker?.terminate()
    this.worker = null
    if (this.loadPending) {
      clearTimeout(this.loadPending.timer)
      this.loadPending.reject(reason)
      this.loadPending = null
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(reason)
    }
    this.pending.clear()
  }
}
