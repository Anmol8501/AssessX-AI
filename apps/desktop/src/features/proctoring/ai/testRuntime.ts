import type { AIRuntime, Detector, DetectorState, Frame, Observation, RawInference, RuntimeInfo, RuntimeState } from './types'

/**
 * TEST-ONLY mock runtime and detector for Phase 5A.
 *
 * These exist solely to exercise the pipeline infrastructure — lifecycle, sampling, backpressure,
 * health transitions and observation flow — before the real Phase 5B detectors exist. They perform
 * **no real detection** and must never be presented as production AI (KB §56, prompt §26): the
 * mock runtime's `productionCapable` flag is false, and it is reachable only through the explicit
 * test seam (`window.__assessxAI`) — `selectComponents()` never returns it in the packaged app.
 *
 * The options let a test drive failure paths deterministically (a failed model load, a slow
 * inference that trips the latency guard, an inference that starts throwing).
 */
export interface MockOptions {
  /** Make `load()` end in LOAD_FAILED. */
  loadFails?: boolean
  /** Delay (ms) inside `load()`. */
  loadDelayMs?: number
  /** Delay (ms) inside each `infer()` — used to simulate slow inference and a DEGRADED state. */
  inferDelayMs?: number
  /** Throw from `infer()` once this many frames have been processed (simulates a runtime error). */
  inferFailsAfter?: number
  /** Make the detector's `init()` fail (ERROR). */
  detectorFails?: boolean
}

const delay = (ms: number | undefined) => (ms && ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve())

/** A deterministic runtime that returns a "heartbeat" for each frame. TEST ONLY. */
export class MockAIRuntime implements AIRuntime {
  readonly info: RuntimeInfo = { id: 'mock', version: '0.1.0', kind: 'mock', productionCapable: false }
  private _state: RuntimeState = 'UNINITIALIZED'
  private seq = 0
  private readonly options: MockOptions

  constructor(options: MockOptions = {}) {
    this.options = options
  }

  get state(): RuntimeState {
    return this._state
  }

  async load(): Promise<void> {
    this._state = 'INITIALIZING'
    await delay(this.options.loadDelayMs)
    this._state = 'LOADING_MODEL'
    if (this.options.loadFails) {
      this._state = 'LOAD_FAILED'
      throw new Error('mock runtime: load failed')
    }
    this._state = 'READY'
  }

  async infer(frame: Frame): Promise<RawInference> {
    if (this._state !== 'READY' && this._state !== 'RUNNING') {
      throw new Error(`mock runtime: infer called in state ${this._state}`)
    }
    this._state = 'RUNNING'
    await delay(this.options.inferDelayMs)
    this.seq++
    if (this.options.inferFailsAfter !== undefined && this.seq > this.options.inferFailsAfter) {
      this._state = 'ERROR'
      throw new Error('mock runtime: inference failed')
    }
    return { frameId: frame.frameId, monotonicTs: frame.monotonicTs, payload: { kind: 'mock-heartbeat', seq: this.seq } }
  }

  async unload(): Promise<void> {
    this._state = 'STOPPING'
    this._state = 'STOPPED'
  }
}

/**
 * A deterministic detector that emits one factual `FRAME_OBSERVED` observation per frame. TEST ONLY.
 * It performs no detection — it only proves that frames flow through to normalized observations.
 */
export class MockDetector implements Detector {
  readonly id = 'mock.frame-observer'
  readonly version = '0.1.0'
  private _state: DetectorState = 'INITIALIZING'
  private count = 0
  private readonly options: MockOptions

  constructor(options: MockOptions = {}) {
    this.options = options
  }

  get state(): DetectorState {
    return this._state
  }

  async init(): Promise<void> {
    if (this.options.detectorFails) {
      this._state = 'ERROR'
      throw new Error('mock detector: init failed')
    }
    this._state = 'RUNNING'
  }

  process(frame: Frame, raw: RawInference): Observation[] {
    if (this._state !== 'RUNNING') return []
    // Only emit when the runtime actually produced output for this frame (proves the seam works).
    if (raw.frameId !== frame.frameId) return []
    this.count++
    return [
      {
        observationId: `${this.id}:${frame.frameId}`,
        detectorId: this.id,
        detectorVersion: this.version,
        observationType: 'FRAME_OBSERVED', // technical: a frame was processed. NOT a detection.
        monotonicTs: frame.monotonicTs,
        wallClock: frame.wallClock,
        confidence: null, // a frame-processed heartbeat has no detection confidence
        metadata: { width: frame.width, height: frame.height, frameId: frame.frameId, seq: this.count },
      },
    ]
  }

  async shutdown(): Promise<void> {
    this._state = 'STOPPED'
  }
}

/**
 * What the scripted runtime "sees" — a description, not pixels. TEST ONLY (Phase 5C E2E).
 * A test mutates `window.__assessxAI.scene` while the exam runs to drive the real detectors.
 */
export interface ScriptedScene {
  /** Faces the face detector reports (each 0.3 × 0.4 of the frame unless `faceAreaRatio` is set). */
  faces?: number
  faceScore?: number
  /** Area of the primary face box as a fraction of the frame. */
  faceAreaRatio?: number
  yawDeg?: number
  pitchDeg?: number
  /** Gaze summaries (−1..1) the eye blendshapes are built to produce. */
  gazeHorizontal?: number
  gazeVertical?: number
  meanLuminance?: number
  /** Objects in view: COCO label (`cell phone`, `book`, `laptop`, `remote`) and the model's score. */
  objects?: { category: string; score: number }[]
  /** Which object model the scene pretends produced them (default YOLOX-S). */
  objectModel?: 'yolox_s' | 'yolox_tiny' | 'efficientdet_lite0'
  /** Make the face landmarker fail (head pose and gaze become unmeasurable). */
  landmarkerFails?: boolean
  /** Make inference throw from now on (the runtime enters ERROR). */
  runtimeFails?: boolean
}

/**
 * A TEST-ONLY runtime that returns MediaPipe-shaped results built from a scripted scene, so the E2E
 * suite can drive the real Phase 5B detectors and the real Phase 5C event processor deterministically
 * (a real webcam cannot be scripted in CI). It performs no detection, is marked not production
 * capable, and is reachable only through the explicit test seam.
 */
export class ScriptedMediaPipeRuntime implements AIRuntime {
  readonly info: RuntimeInfo = { id: 'scripted-mediapipe', version: '0.1.0', kind: 'mock', productionCapable: false, accelerator: 'CPU' }
  private _state: RuntimeState = 'UNINITIALIZED'
  private readonly scene: () => ScriptedScene

  constructor(scene: () => ScriptedScene) {
    this.scene = scene
  }

  get state(): RuntimeState {
    return this._state
  }

  async load(): Promise<void> {
    this._state = 'READY'
  }

  async infer(frame: Frame): Promise<RawInference> {
    if (this._state !== 'READY' && this._state !== 'RUNNING') throw new Error(`scripted runtime: infer in state ${this._state}`)
    const scene = this.scene()
    if (scene.runtimeFails) {
      this._state = 'ERROR'
      throw new Error('scripted runtime: inference failed')
    }
    this._state = 'RUNNING'
    const count = scene.faces ?? 1
    const area = scene.faceAreaRatio ?? 0.12
    const side = Math.sqrt(area)
    const faces = Array.from({ length: count }, (_, index) => ({
      box: { x: 0.1 + index * 0.05, y: 0.2, width: side, height: side },
      score: scene.faceScore ?? 0.9,
    }))
    const landmarkerStatus = count === 0 ? 'SKIPPED' : scene.landmarkerFails ? 'FAILED' : 'OK'
    const h = scene.gazeHorizontal ?? 0
    const v = scene.gazeVertical ?? 0
    const eyes = {
      eyeLookOutLeft: Math.max(h, 0),
      eyeLookInRight: Math.max(h, 0),
      eyeLookInLeft: Math.max(-h, 0),
      eyeLookOutRight: Math.max(-h, 0),
      eyeLookUpLeft: Math.max(v, 0),
      eyeLookUpRight: Math.max(v, 0),
      eyeLookDownLeft: Math.max(-v, 0),
      eyeLookDownRight: Math.max(-v, 0),
    }
    const payload = {
      kind: 'mediapipe',
      tasks: { faceDetector: 'OK', faceLandmarker: landmarkerStatus, objectDetector: 'OK' },
      objectModel: scene.objectModel ?? 'yolox_s',
      faces,
      landmarkedFaces:
        landmarkerStatus === 'OK'
          ? [{ box: faces[0]!.box, transform: poseMatrix(scene.yawDeg ?? 0, scene.pitchDeg ?? 0), eyes }]
          : null,
      objects: (scene.objects ?? []).map((o, index) => ({
        category: o.category,
        score: o.score,
        box: { x: 0.55 + index * 0.05, y: 0.6, width: 0.08, height: 0.12 },
        region: 'full',
      })),
      statistics: { meanLuminance: scene.meanLuminance ?? 0.45, luminanceStdDev: 0.2 },
      timingsMs: { statistics: 0, faceDetector: 0, faceLandmarker: 0, objectDetector: 0, total: 0 },
    }
    return { frameId: frame.frameId, monotonicTs: frame.monotonicTs, payload }
  }

  async unload(): Promise<void> {
    this._state = 'STOPPED'
  }
}

/** A column-major 4×4 rotation Ry(yaw)·Rx(pitch), the form MediaPipe's transformation matrix takes. */
function poseMatrix(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180
  const p = (pitchDeg * Math.PI) / 180
  const [cy, sy, cp, sp] = [Math.cos(y), Math.sin(y), Math.cos(p), Math.sin(p)]
  // columns: R·e0, R·e1, R·e2, translation
  return [cy, 0, -sy, 0, sy * sp, cp, cy * sp, 0, sy * cp, -sp, cy * cp, 0, 0, 0, -60, 1]
}
