/**
 * Object-detection models the AI runtime can use for the phone observation (Phase 5B).
 *
 * Two implementations sit behind the same runtime → `PhoneDetector` → `Observation` path:
 *
 *   * `efficientdet_lite0` — MediaPipe EfficientDet-Lite0. **The default**, unchanged.
 *   * `yolox_tiny` — YOLOX-Tiny through ONNX Runtime Web. **Opt-in, for validation only**, selected
 *     at build time with `VITE_OBJECT_DETECTOR_MODEL=yolox_tiny` (or by the E2E test seam).
 *
 * Neither produces a "phone detected" decision: both report only the most confident phone candidate's
 * raw model confidence. Their scores are **not comparable** with each other, which is why every
 * observation records the model that produced it and why a failed YOLOX load is reported as an error
 * rather than silently replaced by EfficientDet. See docs/PHASE-5B-OBJECT-MODEL-EVALUATION.md.
 */

export type ObjectModelId = 'efficientdet_lite0' | 'yolox_tiny'
export const OBJECT_MODEL_IDS: readonly ObjectModelId[] = ['efficientdet_lite0', 'yolox_tiny']
export const DEFAULT_OBJECT_MODEL: ObjectModelId = 'efficientdet_lite0'

/**
 * YOLOX-Tiny provenance and processing contract. Every value here was checked against the artifact
 * (ONNX graph read with `onnx`) or the YOLOX reference code (`demo/ONNXRuntime/onnx_inference.py`,
 * `yolox/utils/demo_utils.py`) on 2026-09-26.
 */
export const YOLOX_TINY = {
  id: 'yolox_tiny' as const,
  file: 'yolox_tiny.onnx',
  source: 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx',
  release: '0.1.1rc0 (2021-08-18)',
  commit: 'e1052df71842031413f6030723c3607b839c80ce',
  sha256: '427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7',
  bytes: 20_219_662,
  /** ONNX IR 6, opset 11, exported by PyTorch 1.7. */
  input: { name: 'images', shape: [1, 3, 416, 416] as const, type: 'float32' },
  /** Per anchor: cx, cy, w, h (raw), objectness, 80 COCO class scores (sigmoid applied in the graph). */
  output: { name: 'output', shape: [1, 3549, 85] as const, type: 'float32' },
  size: 416,
  /** 52² + 26² + 13² = 3549 anchors. */
  strides: [8, 16, 32] as const,
  /** Contiguous COCO-80 index of "cell phone". */
  classIndex: 67,
  classLabel: 'cell phone',
  /** Letterbox: aspect-preserving resize, placed top-left, padded with this value; BGR; 0..255. */
  padValue: 114,
  /** Class-wise NMS IoU from the YOLOX demo. The demo's 0.1 score cut-off is NOT applied here. */
  nmsIou: 0.45,
}

/** The build's configured object model, or an error for an unknown value (reported, never guessed). */
export function configuredObjectModel(value: string | undefined): { model: ObjectModelId } | { error: string } {
  const raw = (value ?? '').trim()
  if (raw === '') return { model: DEFAULT_OBJECT_MODEL }
  return (OBJECT_MODEL_IDS as readonly string[]).includes(raw)
    ? { model: raw as ObjectModelId }
    : { error: `Unknown object model "${raw}" (expected ${OBJECT_MODEL_IDS.join(' or ')})` }
}
