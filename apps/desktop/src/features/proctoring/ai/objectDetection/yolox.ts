import type { NormalizedBox } from '../mediapipe/protocol'

/**
 * YOLOX pre- and post-processing (pure; no runtime, no DOM), matching the YOLOX reference code:
 * `yolox/data/data_augment.py::preproc` and `yolox/utils/demo_utils.py::demo_postprocess` / `nms`.
 */

/** How a frame is placed in the square model input: aspect-preserving, top-left, padded. */
export interface Letterbox {
  size: number
  /** Scale from the source frame to the model input (`r` in the reference code). */
  scale: number
  /** Drawn width/height of the frame inside the input, in input pixels. */
  width: number
  height: number
}

export function letterbox(sourceWidth: number, sourceHeight: number, size: number): Letterbox {
  const scale = Math.min(size / sourceHeight, size / sourceWidth)
  return { size, scale, width: Math.round(sourceWidth * scale), height: Math.round(sourceHeight * scale) }
}

/**
 * Packs an RGBA image (already letterboxed to `size`×`size`) into the model tensor: NCHW, **BGR**
 * channel order, raw 0..255 values (YOLOX ≥ 0.1.1 applies no mean/std normalisation).
 */
export function toBgrTensor(rgba: ArrayLike<number>, size: number): Float32Array {
  const plane = size * size
  const tensor = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    tensor[i] = rgba[i * 4 + 2] ?? 0 // B
    tensor[plane + i] = rgba[i * 4 + 1] ?? 0 // G
    tensor[2 * plane + i] = rgba[i * 4] ?? 0 // R
  }
  return tensor
}

export interface Candidate {
  score: number
  /** In the source frame, normalised 0..1. */
  box: NormalizedBox
}

/**
 * Decodes one class from the raw output `[N, 5 + classes]` into scored boxes in the source frame.
 * Anchors are laid out level by level (strides ascending), row-major within a level. For anchor
 * (x, y) at stride s: centre = (raw + grid) · s, size = exp(raw) · s, in input pixels; divided by the
 * letterbox scale to return to source pixels. Score = objectness × class probability.
 */
export function decodeClass(
  output: ArrayLike<number>,
  stride: number,
  classIndex: number,
  strides: readonly number[],
  box: Letterbox,
  sourceWidth: number,
  sourceHeight: number,
): Candidate[] {
  const candidates: Candidate[] = []
  let anchor = 0
  for (const s of strides) {
    const grid = Math.round(box.size / s)
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const o = anchor * stride
        anchor++
        const score = (output[o + 4] ?? 0) * (output[o + 5 + classIndex] ?? 0)
        const cx = ((output[o] ?? 0) + gx) * s
        const cy = ((output[o + 1] ?? 0) + gy) * s
        const w = Math.exp(output[o + 2] ?? 0) * s
        const h = Math.exp(output[o + 3] ?? 0) * s
        const x0 = clamp((cx - w / 2) / box.scale / sourceWidth)
        const y0 = clamp((cy - h / 2) / box.scale / sourceHeight)
        const x1 = clamp((cx + w / 2) / box.scale / sourceWidth)
        const y1 = clamp((cy + h / 2) / box.scale / sourceHeight)
        candidates.push({ score, box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
      }
    }
  }
  return candidates
}

export function anchorCount(size: number, strides: readonly number[]): number {
  return strides.reduce((total, s) => total + Math.round(size / s) ** 2, 0)
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function iou(a: NormalizedBox, b: NormalizedBox): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const inter = w * h
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

/**
 * Greedy class-wise NMS (highest score first; drop boxes overlapping a kept one by more than `iouLimit`),
 * keeping at most `maxResults`. No score threshold is applied — that decision is not made in Phase 5B.
 */
export function nms(candidates: Candidate[], iouLimit: number, maxResults: number): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const kept: Candidate[] = []
  for (const candidate of sorted) {
    if (kept.length >= maxResults) break
    if (kept.every((k) => iou(k.box, candidate.box) <= iouLimit)) kept.push(candidate)
  }
  return kept
}
