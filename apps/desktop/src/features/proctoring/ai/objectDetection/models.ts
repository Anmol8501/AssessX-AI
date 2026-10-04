/**
 * Object-detection models the AI runtime can use (Phase 5B, made to fire in the object-detection
 * stage of 2026-10-02).
 *
 * Product-owner decision (2026-10-02): **YOLOX-S where WebGPU works, YOLOX-Tiny otherwise** — the
 * `yolox` mode, the default. Both are Megvii's official Apache-2.0 ONNX releases, run by ONNX Runtime
 * Web inside the AI worker. The other ids stay selectable at build time
 * (`VITE_OBJECT_DETECTOR_MODEL`) for validation:
 *
 *   * `yolox` (default) — YOLOX-S on WebGPU (validated by a warm-up inference), else YOLOX-Tiny on
 *     WebAssembly. The model that actually runs is reported in every observation (`objectModel`).
 *   * `yolox_s` / `yolox_tiny` — force one model.
 *   * `efficientdet_lite0` — the original MediaPipe model (kept for comparison).
 *
 * Scores are **not comparable between models**, which is why every threshold is per model and every
 * observation records the model that produced it. See docs/PHASE-5D-OBJECT-DETECTION.md.
 */

/** What a build asks for. */
export type ObjectModelId = 'yolox' | 'yolox_s' | 'yolox_tiny' | 'efficientdet_lite0'
export const OBJECT_MODEL_IDS: readonly ObjectModelId[] = ['yolox', 'yolox_s', 'yolox_tiny', 'efficientdet_lite0']
export const DEFAULT_OBJECT_MODEL: ObjectModelId = 'yolox'

/** What actually runs (the `yolox` mode resolves to one of the two YOLOX models). */
export type RunningObjectModel = 'yolox_s' | 'yolox_tiny' | 'efficientdet_lite0'

/**
 * The reported object classes (product-owner decision, 2026-10-02): a mobile phone, a book, another
 * laptop or tablet, and a remote/calculator-like handheld device. COCO-80 contiguous indices (YOLOX
 * output order) and COCO labels (EfficientDet's label map), checked against the COCO class list.
 * Earbuds, smartwatches and paper notes are not COCO classes, so no free model can report them.
 */
export const OBJECT_CLASSES = [
  { id: 'cell_phone', label: 'cell phone', cocoIndex: 67 },
  { id: 'book', label: 'book', cocoIndex: 73 },
  { id: 'laptop', label: 'laptop', cocoIndex: 63 },
  { id: 'remote', label: 'remote', cocoIndex: 65 },
] as const
export type ObjectClassId = (typeof OBJECT_CLASSES)[number]['id']

export interface YoloxSpec {
  id: 'yolox_s' | 'yolox_tiny'
  file: string
  source: string
  sha256: string
  bytes: number
  input: { name: string; shape: readonly [1, 3, number, number] }
  output: { name: string; shape: readonly [1, number, 85] }
  size: number
  strides: readonly number[]
  /** Letterbox: aspect-preserving resize, placed top-left, padded with this value; BGR; 0..255. */
  padValue: number
  /** Class-wise NMS IoU from the YOLOX demo. */
  nmsIou: number
}

/**
 * Provenance and processing contract. Release 0.1.1rc0 (2021-08-18), commit e1052df7, Apache-2.0.
 * Digests and tensor shapes were checked against the downloaded artifacts with ONNX Runtime on
 * 2026-10-02 (inputs `images`, outputs `output` [1, 8400, 85] for S and [1, 3549, 85] for Tiny).
 */
const RELEASE = 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0'

export const YOLOX_S: YoloxSpec = {
  id: 'yolox_s',
  file: 'yolox_s.onnx',
  source: `${RELEASE}/yolox_s.onnx`,
  sha256: 'c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063',
  bytes: 35_858_002,
  input: { name: 'images', shape: [1, 3, 640, 640] },
  /** 80² + 40² + 20² = 8400 anchors. */
  output: { name: 'output', shape: [1, 8400, 85] },
  size: 640,
  strides: [8, 16, 32],
  padValue: 114,
  nmsIou: 0.45,
}

export const YOLOX_TINY: YoloxSpec = {
  id: 'yolox_tiny',
  file: 'yolox_tiny.onnx',
  source: `${RELEASE}/yolox_tiny.onnx`,
  sha256: '427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7',
  bytes: 20_219_662,
  input: { name: 'images', shape: [1, 3, 416, 416] },
  /** 52² + 26² + 13² = 3549 anchors. */
  output: { name: 'output', shape: [1, 3549, 85] },
  size: 416,
  strides: [8, 16, 32],
  padValue: 114,
  nmsIou: 0.45,
}

export const YOLOX_SPECS: Record<YoloxSpec['id'], YoloxSpec> = { yolox_s: YOLOX_S, yolox_tiny: YOLOX_TINY }

/** The build's configured object model, or an error for an unknown value (reported, never guessed). */
export function configuredObjectModel(value: string | undefined): { model: ObjectModelId } | { error: string } {
  const raw = (value ?? '').trim()
  if (raw === '') return { model: DEFAULT_OBJECT_MODEL }
  return (OBJECT_MODEL_IDS as readonly string[]).includes(raw)
    ? { model: raw as ObjectModelId }
    : { error: `Unknown object model "${raw}" (expected one of ${OBJECT_MODEL_IDS.join(', ')})` }
}

/**
 * The order in which YOLOX models and backends are tried for a mode. `yolox`: YOLOX-S on WebGPU when
 * the device has a GPU adapter (accepted only after a warm-up succeeds), else YOLOX-Tiny on WebGPU,
 * and always YOLOX-Tiny on WebAssembly last — YOLOX-S on CPU (~2.5 s a frame) is never used.
 */
export function yoloxAttempts(mode: ObjectModelId, hasGpu: boolean): { model: YoloxSpec['id']; provider: 'webgpu' | 'wasm' }[] {
  if (mode === 'yolox_s') return hasGpu ? [{ model: 'yolox_s', provider: 'webgpu' }, { model: 'yolox_s', provider: 'wasm' }] : [{ model: 'yolox_s', provider: 'wasm' }]
  if (mode === 'yolox_tiny') return hasGpu ? [{ model: 'yolox_tiny', provider: 'webgpu' }, { model: 'yolox_tiny', provider: 'wasm' }] : [{ model: 'yolox_tiny', provider: 'wasm' }]
  if (mode === 'yolox') {
    return hasGpu
      ? [
          { model: 'yolox_s', provider: 'webgpu' },
          { model: 'yolox_tiny', provider: 'webgpu' },
          { model: 'yolox_tiny', provider: 'wasm' },
        ]
      : [{ model: 'yolox_tiny', provider: 'wasm' }]
  }
  return []
}
