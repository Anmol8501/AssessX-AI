import { YOLOX_TINY } from '../objectDetection/models'
import type { TaskName } from './protocol'

/**
 * Phase 5B MediaPipe runtime configuration.
 *
 * Decided:
 *   * Runtime: MediaPipe Tasks Vision (`@mediapipe/tasks-vision`, Apache-2.0) — the KB/TRD name
 *     MediaPipe for face landmarks, head orientation and gaze.
 *   * Object model: MediaPipe EfficientDet-Lite0 (COCO), reporting **cell phone only**. This is a
 *     product-owner decision (2026-09-26) and a recorded deviation from the documents' "YOLO"
 *     wording, chosen because Ultralytics YOLO is AGPL-3.0.
 *
 * UNRESOLVED — requires Phase 5 technical decision (provisional values, not validated targets):
 *   * `PREFER_GPU`: whether to try MediaPipe's GPU (WebGL) delegate first. **Off.** Diagnosed
 *     2026-09-26 (headless Edge and the packaged WebView2, Intel UHD via ANGLE/D3D11): the GPU path
 *     works for every task combination, ~115–160 ms per frame for all three models vs ~290 ms on
 *     CPU — but the *first* inference compiles shaders and took 7.8 s from a cold start, longer than
 *     `INFERENCE_TIMEOUT_MS`, so the watchdog terminated it (first reported, wrongly, as a hang).
 *     Enabling GPU needs a warm-up inference inside `load()` (bounded by `LOAD_TIMEOUT_MS`) and
 *     testing on more hardware; until then the verified CPU (XNNPACK) path is used.
 *   * `LANDMARKER_MAX_FACES`: how many faces get pose/gaze measurements. The face *count* comes from
 *     the face detector and is not limited by this.
 *   * `LOAD_TIMEOUT_MS` / `INFERENCE_TIMEOUT_MS`: safety nets so a hung runtime is reported as an
 *     error instead of silently stalling — not performance targets.
 *   * Detection-confidence minimums: MediaPipe's own library/model defaults are kept; none is set here.
 */
export const PREFER_GPU = false
export const LANDMARKER_MAX_FACES = 1
export const LOAD_TIMEOUT_MS = 60_000
export const INFERENCE_TIMEOUT_MS = 5_000

/**
 * YOLOX-Tiny (opt-in object model): try WebGPU first and accept it only if a warm-up inference
 * finishes within `YOLOX_WARMUP_TIMEOUT_MS`; otherwise WebAssembly. Both are UNRESOLVED provisional
 * values like the ones above — WebGPU is not required, and the CPU path always exists.
 */
export const YOLOX_PREFER_WEBGPU = true
export const YOLOX_WARMUP_TIMEOUT_MS = 30_000

/** COCO label used by EfficientDet-Lite0 for a mobile phone. */
export const OBJECT_CATEGORIES = ['cell phone']

/** Served from the app itself (`public/`), prepared by `scripts/fetch-ai-assets.mjs`. */
export const MODEL_FILES: Record<TaskName, string> = {
  faceDetector: 'blaze_face_short_range.tflite',
  faceLandmarker: 'face_landmarker.task',
  objectDetector: 'efficientdet_lite0.tflite',
}

export const RUNTIME_VERSION = '1.0.1' // @mediapipe/tasks-vision, pinned exactly in package.json

/** Absolute URLs (the worker resolves nothing relative to itself). */
export function assetUrls(origin: string) {
  const at = (path: string) => new URL(path, origin).toString()
  return {
    yoloxModel: at(`/models/${YOLOX_TINY.file}`),
    ortWasmPaths: at('/onnxruntime/'),
    wasmLoaderPath: at('/mediapipe/wasm/vision_wasm_module_internal.js'),
    wasmBinaryPath: at('/mediapipe/wasm/vision_wasm_module_internal.wasm'),
    models: {
      faceDetector: at(`/models/${MODEL_FILES.faceDetector}`),
      faceLandmarker: at(`/models/${MODEL_FILES.faceLandmarker}`),
      objectDetector: at(`/models/${MODEL_FILES.objectDetector}`),
    } satisfies Record<TaskName, string>,
  }
}
