import type { ObjectModelId, RunningObjectModel } from '../objectDetection/models'

/**
 * Phase 5B: the message protocol between the page and the MediaPipe inference worker, and the shape
 * of the per-frame result the detectors read.
 *
 * **Data minimisation is enforced here, at the thread boundary.** The worker returns only what the
 * detectors need: face boxes and detector scores, one pose matrix per landmarked face, the eight
 * eye-direction blendshape scores, phone boxes/scores and two luminance statistics. It never
 * returns the 478 facial landmarks, the other facial-expression blendshapes, or any pixels — face
 * geometry is biometric-adjacent and nothing downstream needs it (KB §42: avoid unnecessary
 * biometric storage; no identity or recognition in Phase 5).
 */

/** A rectangle in normalised frame coordinates (0..1, origin top-left). */
export interface NormalizedBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * How one MediaPipe task fared for a frame. `UNAVAILABLE` means its model never loaded; `FAILED`
 * means it threw on this frame; `SKIPPED` means it was deliberately not run (the face landmarker
 * is skipped when the face detector found no face). Only `OK` results carry data — a detector must
 * never read "no data" as "nothing observed".
 */
export type TaskStatus = 'OK' | 'SKIPPED' | 'FAILED' | 'UNAVAILABLE'

export type TaskName = 'faceDetector' | 'faceLandmarker' | 'objectDetector' | 'poseLandmarker'

export type Accelerator = 'GPU' | 'CPU'

/** The eye-direction blendshape scores the landmarker reports (0..1 each). */
export const EYE_BLENDSHAPES = [
  'eyeLookInLeft',
  'eyeLookOutLeft',
  'eyeLookUpLeft',
  'eyeLookDownLeft',
  'eyeLookInRight',
  'eyeLookOutRight',
  'eyeLookUpRight',
  'eyeLookDownRight',
] as const
export type EyeBlendshape = (typeof EYE_BLENDSHAPES)[number]

export interface DetectedFace {
  box: NormalizedBox
  /** The face detector's own score, or null if it gave none. Model confidence only. */
  score: number | null
}

export interface LandmarkedFace {
  box: NormalizedBox
  /** The 4×4 facial transformation matrix as MediaPipe returns it (column-major), or null. */
  transform: number[] | null
  /** The eye-direction blendshape scores, or null when blendshapes were not produced. */
  eyes: Partial<Record<EyeBlendshape, number>> | null
}

export interface DetectedObject {
  /** The model's category label, e.g. `cell phone` (COCO). */
  category: string
  score: number | null
  box: NormalizedBox
  /** Where it was found: the whole frame, or a zoomed tile (small-object coverage). Diagnostic only. */
  region?: 'full' | 'tile'
}

/**
 * One shoulder from the pose landmarker, normalised to the frame (0..1; may fall outside when the
 * model extrapolates beyond the edge). Only the two shoulders leave the worker — never the skeleton.
 */
export interface PosePoint {
  x: number
  y: number
  /** The model's visibility score, 0..1. */
  visibility: number
}

export interface FrameStatistics {
  /** Mean relative luminance of the frame, 0 (black) .. 1 (white). */
  meanLuminance: number
  /** Standard deviation of luminance, 0..0.5 — a simple global contrast measure. */
  luminanceStdDev: number
}

/** Everything the runtime produced for one frame. This is `RawInference.payload` for this runtime. */
export interface MediaPipePayload {
  kind: 'mediapipe'
  tasks: Record<TaskName, TaskStatus>
  /** Which object model produced `objects` (their scores are not comparable across models). */
  objectModel: RunningObjectModel
  faces: DetectedFace[] | null
  landmarkedFaces: LandmarkedFace[] | null
  objects: DetectedObject[] | null
  /** The first detected person's left and right shoulder, or null when the pose task did not run. */
  shoulders: [PosePoint, PosePoint] | null
  statistics: FrameStatistics | null
  /** Wall time spent in each stage inside the worker, ms. Technical telemetry only. */
  timingsMs: {
    statistics: number
    faceDetector: number
    faceLandmarker: number
    objectDetector: number
    poseLandmarker: number
    total: number
  }
}

export function isMediaPipePayload(value: unknown): value is MediaPipePayload {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'mediapipe'
}

/** YOLOX backend settings (used for the `yolox`, `yolox_s` and `yolox_tiny` modes). */
export interface YoloxLoadConfig {
  /** Where each YOLOX model is served from, and its expected SHA-256 (a mismatch fails the load). */
  models: Record<'yolox_s' | 'yolox_tiny', { url: string; sha256: string }>
  /** Where ONNX Runtime Web's WebAssembly files are served from. */
  wasmPaths: string
  /** Try WebGPU first (validated by a warm-up inference), falling back to WebAssembly. */
  preferWebGPU: boolean
  /** A WebGPU warm-up slower than this falls back to WebAssembly. */
  warmupTimeoutMs: number
}

/** How the object detector actually came up — reported, never assumed. */
export interface ObjectBackendReport {
  model: RunningObjectModel
  /** `webgpu` / `wasm` for YOLOX; `CPU` / `GPU` (MediaPipe delegate) for EfficientDet. */
  accelerator: string
  /** Model fetch + integrity check + session creation (YOLOX), or task creation (EfficientDet). */
  loadMs: number
  /** First (warm-up) inference, which compiles kernels/shaders; null when no warm-up is done. */
  warmupMs: number | null
  /** The first inference after warm-up; null when no warm-up is done. */
  firstInferenceMs: number | null
  /** Why a preferred path was abandoned (e.g. WebGPU unavailable), if it was. */
  fallback: string | null
}

/** Paths and task options sent to the worker at load time. */
export interface WorkerLoadConfig {
  wasmLoaderPath: string
  wasmBinaryPath: string
  models: Record<TaskName, string>
  /** Try the GPU delegate first and fall back to CPU, or use CPU only. */
  preferGpu: boolean
  /** Categories the object detector reports; everything else is filtered out by the model itself. */
  objectCategories: string[]
  /** How many faces the landmarker measures (pose/gaze). The face *count* comes from the detector. */
  landmarkerMaxFaces: number
  /** Which object model mode to load (`yolox` by default: YOLOX-S on WebGPU, else YOLOX-Tiny). */
  objectModel: ObjectModelId
  yolox: YoloxLoadConfig
}

export type WorkerRequest =
  | { type: 'load'; config: WorkerLoadConfig }
  | { type: 'infer'; id: number; timestampMs: number; bitmap: ImageBitmap }
  | { type: 'dispose' }

export type WorkerResponse =
  | {
      type: 'loaded'
      tasks: Record<TaskName, 'READY' | 'UNAVAILABLE'>
      /** The MediaPipe tasks' delegate (`GPU` only if every MediaPipe task runs on it). */
      accelerator: Accelerator
      objectBackend: ObjectBackendReport | null
      errors: string[]
    }
  | { type: 'load-failed'; error: string }
  | { type: 'result'; id: number; payload: MediaPipePayload }
  | { type: 'infer-failed'; id: number; error: string }
  | { type: 'disposed' }
