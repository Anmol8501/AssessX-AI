/**
 * Phase 5A — AI Proctoring Foundation: the model-agnostic contracts.
 *
 * These types are the seam every future detector (Phase 5B) and every event integration
 * (Phase 5C) depends on. They deliberately describe **perception**, never judgement: an
 * observation says what was seen ("a frame was processed", later "a face was detected"), and a
 * `confidence` is the *model's* confidence in that detection — it is never a probability that a
 * candidate cheated. There is intentionally no `cheating_score`, `risk_score`, `severity` or
 * `verdict` field anywhere in this module; correlation and risk belong to a later phase.
 *
 * Where inference runs. The AssessX documents (Master KB §44–49, TRD §8–10, §49) forbid sending
 * every frame to the backend / through FastAPI, describe the *eventual* server-side GPU-worker
 * pipeline as a scale-time extraction, and require models to stay replaceable — but they do not
 * fix an inference location for the desktop client, a frame rate, a resolution, a model version or
 * a threshold. Phase 5A therefore runs on-device (in the WebView, over the camera stream the
 * proctoring session already opened) behind these abstractions, so a later move to a bundled native
 * runtime or to server-side workers swaps only the `AIRuntime`, not the pipeline. No model-specific
 * value is invented here; the numeric defaults in `config.ts` are infrastructure placeholders,
 * clearly marked as such, to be replaced by the Phase 5 Knowledge Base / Phase 5B.
 */

/**
 * One acquired camera frame handed to the runtime. The pixels live in `bitmap`, which the pipeline
 * always releases (`close()`) once processing finishes — frames are used and discarded, never
 * stored, uploaded or logged (privacy: KB §42, plan 5A.5).
 */
export interface Frame {
  /** Monotonically increasing id within one pipeline run. */
  frameId: number
  /** Capture time from a monotonic clock (`performance.now()`), for deterministic scheduling. */
  monotonicTs: number
  /** Wall-clock capture time (ISO-8601), for correlation and logging only. */
  wallClock: string
  width: number
  height: number
  /** Decoded pixels for a runtime to read; owned by the frame and released by `close()`. */
  bitmap: ImageBitmap | null
  /** Releases pixel resources. Idempotent. Called by the pipeline after every frame. */
  close(): void
}

/**
 * Opaque model output for one frame. Its `payload` shape is known only to the runtime that produced
 * it and the detectors paired with that runtime; the pipeline never inspects it. This keeps the
 * pipeline independent of any particular model framework (TRD §34, plan 5A.3).
 */
export interface RawInference {
  frameId: number
  monotonicTs: number
  payload: unknown
  /** Optional per-stage timings (ms) the runtime measured for this frame. Technical telemetry only. */
  timingsMs?: Record<string, number>
}

/** A rectangle in normalised frame coordinates (0..1, origin top-left). */
export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

/** A factual, model-independent perception result. Never a judgement — see the file header. */
export interface Observation {
  observationId: string
  detectorId: string
  detectorVersion: string
  /**
   * A factual perception label, e.g. `FRAME_OBSERVED` (the 5A test detector). Real detection labels
   * such as `FACE_PRESENT` / `MULTIPLE_FACES` arrive with the Phase 5B detectors; their exact names
   * are finalised against the Phase 5 Knowledge Base.
   */
  observationType: string
  monotonicTs: number
  wallClock: string
  /** MODEL/detector confidence in the detection, 0..1, or null when the model gives none. NOT a cheating probability. */
  confidence: number | null
  /** Where in the frame the observation applies, when the detector localises it. */
  boundingBox?: BoundingBox
  metadata: Record<string, string | number | boolean>
}

/** Runtime lifecycle (plan 5A.3, prompt §11). A runtime never reports READY/RUNNING when it failed. */
export type RuntimeState =
  | 'UNINITIALIZED'
  | 'INITIALIZING'
  | 'LOADING_MODEL'
  | 'READY'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'LOAD_FAILED'
  | 'ERROR'

export interface RuntimeInfo {
  id: string
  version: string
  /** The framework family, e.g. `mock`, `onnx`, `mediapipe`, `native`. Descriptive only. */
  kind: string
  /** False for the test/mock runtime, so the UI and logs never imply real detection in 5A. */
  productionCapable: boolean
  /** The compute backend actually in use once loaded (`GPU` only if every task runs on it), or null. */
  accelerator?: 'GPU' | 'CPU' | null
  /** How the object detector came up: model, accelerator, and load / warm-up / first-inference timings. */
  objectDetector?: {
    model: string
    accelerator: string
    loadMs: number
    warmupMs: number | null
    firstInferenceMs: number | null
    fallback: string | null
  } | null
  /** Why any task failed to load (e.g. a missing or corrupted model) — shown, never hidden. */
  loadErrors?: string[]
}

/**
 * A replaceable inference engine (plan 5A.3, TRD §34). Loading, preprocessing and inference all
 * live behind this interface so the rest of AssessX depends on no single model framework. Phase 5A
 * ships no production runtime — a real ONNX/MediaPipe runtime is Phase 5B; the only implementation
 * here is the test-only mock in `testRuntime.ts`, reachable solely through the test seam.
 */
export interface AIRuntime {
  readonly info: RuntimeInfo
  readonly state: RuntimeState
  /** UNINITIALIZED → LOADING_MODEL → READY, or → LOAD_FAILED. Must be honest about failure. */
  load(): Promise<void>
  /** Runs inference on one frame. Preprocessing is the runtime's own concern (model-specific). */
  infer(frame: Frame): Promise<RawInference>
  /** READY/RUNNING → STOPPING → STOPPED, releasing model resources. */
  unload(): Promise<void>
}

/** Per-detector technical health (plan 5A.6). Kept separate from any candidate observation. */
export type DetectorState = 'INITIALIZING' | 'RUNNING' | 'DEGRADED' | 'ERROR' | 'STOPPED'

/**
 * A single perception unit that turns a runtime's raw output for a frame into zero or more factual
 * observations (plan 5A.4, TRD §33/§34). Phase 5B implements the real detectors (face, count,
 * object, head pose, gaze, quality) against exactly this interface; Phase 5A ships only the
 * test-only mock detector.
 */
export interface Detector {
  readonly id: string
  readonly version: string
  readonly state: DetectorState
  init(): Promise<void>
  /** Pure and synchronous: given a frame and its raw inference, return factual observations. */
  process(frame: Frame, raw: RawInference): Observation[]
  /**
   * Clears any short-lived cross-frame state (e.g. face tracks). Called when the camera stream
   * changes; `shutdown()` clears it too. Optional — stateless detectors need not implement it.
   */
  reset?(): void
  shutdown(): Promise<void>
}

/** Aggregate technical health of the AI pipeline (plan 5A.6). Technical only — not a cheating judgement. */
export type AIHealthState = 'INITIALIZING' | 'RUNNING' | 'DEGRADED' | 'ERROR' | 'STOPPED'

export interface AIHealth {
  state: AIHealthState
  /** An honest, human-readable reason whenever the state is DEGRADED or ERROR; null otherwise. */
  reason: string | null
  cameraAvailable: boolean
  runtimeState: RuntimeState
  detectors: { id: string; state: DetectorState }[]
}

/** Technical performance counters (plan 5A.7, prompt §17). No image data — counts and timings only. */
export interface PipelineTelemetry {
  framesCaptured: number
  framesProcessed: number
  /**
   * Ticks that found inference still busy. The scheduler chains ticks after each frame completes,
   * so this is 0 by construction; slow inference lowers `processedFps` instead of queueing frames.
   */
  framesDropped: number
  /** Ticks where the camera had no frame ready (e.g. still opening or disconnected). */
  framesUnavailable: number
  lastLatencyMs: number | null
  avgLatencyMs: number | null
  processedFps: number | null
  runtimeLoadMs: number | null
  startedAt: string | null
  /** Which runtime is running and on what compute backend (null when there is no runtime). */
  runtime: Pick<RuntimeInfo, 'id' | 'version' | 'kind' | 'productionCapable' | 'accelerator' | 'objectDetector' | 'loadErrors'> | null
  /** The last frame's per-stage timings as reported by the runtime (ms), or null. */
  lastStageTimingsMs: Record<string, number> | null
}

/** A read-only view of the running pipeline for the UI and the test seam. */
export interface AIPipelineView {
  health: AIHealth
  telemetry: PipelineTelemetry
  recentObservations: Observation[]
}
