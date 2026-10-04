import type { NormalizedBox } from '../mediapipe/protocol'
import { iou, type Candidate } from './yolox'

/**
 * Small-object coverage by tiling (object-detection stage, 2026-10-02).
 *
 * A phone held low, at arm's length or half out of view covers only a few dozen pixels of a webcam
 * frame. Shrunk further to fit the model's input, it falls below what the model can see. So, besides
 * the whole frame, the detector also looks at **zoomed regions**: four overlapping quadrants, each
 * 60% of the frame's width and height. In a quadrant the same object is about 1.7× larger in the
 * model input. (The same idea as "slicing-aided" inference; nothing is stored.)
 *
 * Checking every region on every frame would cost five inferences per frame, so the regions are
 * **rotated**: each object pass runs the whole frame plus one quadrant (on WebGPU), or one region per
 * pass, every other frame (on the slower WebAssembly path). Every quadrant is still checked within a
 * few seconds, and the event layer's temporal confirmation is built for evidence that arrives this way.
 */

/** A region of the frame, in normalised coordinates. */
export type Region = NormalizedBox

export const FULL_FRAME: Region = { x: 0, y: 0, width: 1, height: 1 }

const TILE = 0.6
const OFFSET = 1 - TILE // 0.4 — tiles overlap by 0.2 of the frame, so an object on a seam is whole in one
export const TILES: readonly Region[] = [
  { x: 0, y: 0, width: TILE, height: TILE },
  { x: OFFSET, y: 0, width: TILE, height: TILE },
  { x: 0, y: OFFSET, width: TILE, height: TILE },
  { x: OFFSET, y: OFFSET, width: TILE, height: TILE },
]

export type ObjectProvider = 'webgpu' | 'wasm' | 'mediapipe'

/**
 * Which regions the object detector looks at on the `frameIndex`-th processed frame (0-based).
 *
 *   * `webgpu` (YOLOX-S/Tiny, ~45–115 ms an inference): every frame — the whole frame plus one tile,
 *     tiles in rotation.
 *   * `wasm` (YOLOX-Tiny on CPU, ~0.6 s an inference): every other frame, one region at a time,
 *     alternating the whole frame and the next tile — about one inference a second.
 *   * `mediapipe` (EfficientDet-Lite0): every frame, the whole frame only (its comparison path).
 *
 * An empty list means "not this frame": the detector is skipped and its reading is unknown, never
 * "nothing there".
 */
export function regionsFor(frameIndex: number, provider: ObjectProvider): Region[] {
  if (provider === 'mediapipe') return [FULL_FRAME]
  if (provider === 'webgpu') return [FULL_FRAME, TILES[frameIndex % TILES.length]!]
  if (frameIndex % 2 === 1) return []
  const pass = frameIndex / 2
  return pass % 2 === 0 ? [FULL_FRAME] : [TILES[((pass - 1) / 2) % TILES.length]!]
}

/** Maps a box found inside `region` (normalised to the region) back to the whole frame. */
export function toFrame(box: NormalizedBox, region: Region): NormalizedBox {
  return {
    x: region.x + box.x * region.width,
    y: region.y + box.y * region.height,
    width: box.width * region.width,
    height: box.height * region.height,
  }
}

/** The region's pixel rectangle in a `width`×`height` frame (rounded, at least 1 px). */
export function pixelRect(region: Region, width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.round(region.x * width)
  const sy = Math.round(region.y * height)
  return {
    sx,
    sy,
    sw: Math.max(1, Math.min(width - sx, Math.round(region.width * width))),
    sh: Math.max(1, Math.min(height - sy, Math.round(region.height * height))),
  }
}

/**
 * Merges one class's candidates from several regions (already in frame coordinates): the same object
 * seen in the whole frame and in a tile is kept once, at its highest score. Greedy, highest first;
 * boxes overlapping a kept one by more than `iouLimit`, or lying mostly inside it, are dropped.
 */
export function mergeRegions(candidates: Candidate[], iouLimit: number, maxResults: number): Candidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score)
  const kept: Candidate[] = []
  for (const candidate of sorted) {
    if (kept.length >= maxResults) break
    if (kept.every((k) => iou(k.box, candidate.box) <= iouLimit && containment(candidate.box, k.box) < 0.8)) kept.push(candidate)
  }
  return kept
}

/** Share of `a`'s area that lies inside `b` (a cropped tile view of an object often sits inside the full-frame box). */
function containment(a: NormalizedBox, b: NormalizedBox): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  const area = a.width * a.height
  return area > 0 ? (w * h) / area : 0
}
