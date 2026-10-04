import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhoneDetector } from '../detectors/object'
import type { WorkerRequest } from '../mediapipe/protocol'
import { MediaPipeRuntime } from '../mediapipe/runtime'
import { configuredObjectModel, DEFAULT_OBJECT_MODEL, OBJECT_CLASSES, YOLOX_S, YOLOX_TINY, yoloxAttempts } from '../objectDetection/models'
import { FULL_FRAME, mergeRegions, pixelRect, regionsFor, TILES, toFrame } from '../objectDetection/tiling'
import { anchorCount, decodeClass, decodeClasses, letterbox, nms, toBgrTensor } from '../objectDetection/yolox'
import { selectComponents } from '../seam'
import { frame, payload, raw } from './fixtures'

const STRIDE = YOLOX_TINY.output.shape[2] // 85 values per anchor

/** A zeroed YOLOX-Tiny output with one anchor set. */
function outputWith(anchor: number, values: { cx: number; cy: number; w: number; h: number; obj: number; cls: Record<number, number> }) {
  const out = new Float32Array(YOLOX_TINY.output.shape[1] * STRIDE)
  const o = anchor * STRIDE
  out[o] = values.cx
  out[o + 1] = values.cy
  out[o + 2] = values.w
  out[o + 3] = values.h
  out[o + 4] = values.obj
  for (const [index, score] of Object.entries(values.cls)) out[o + 5 + Number(index)] = score
  return out
}

describe('YOLOX contracts', () => {
  it('the pinned signatures are internally consistent', () => {
    expect(anchorCount(YOLOX_TINY.size, YOLOX_TINY.strides)).toBe(YOLOX_TINY.output.shape[1]) // 3549
    expect(anchorCount(YOLOX_S.size, YOLOX_S.strides)).toBe(YOLOX_S.output.shape[1]) // 8400
    expect(YOLOX_TINY.input.shape).toEqual([1, 3, 416, 416])
    expect(YOLOX_S.input.shape).toEqual([1, 3, 640, 640])
    expect(STRIDE).toBe(5 + 80)
    expect(YOLOX_TINY.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(YOLOX_S.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reports four COCO classes: phone 67, book 73, laptop 63, remote 65', () => {
    expect(OBJECT_CLASSES.map((c) => [c.id, c.cocoIndex])).toEqual([
      ['cell_phone', 67],
      ['book', 73],
      ['laptop', 63],
      ['remote', 65],
    ])
  })

  it('defaults to the yolox mode, accepts the others, and rejects unknown values', () => {
    expect(DEFAULT_OBJECT_MODEL).toBe('yolox')
    expect(configuredObjectModel(undefined)).toEqual({ model: 'yolox' })
    expect(configuredObjectModel('  ')).toEqual({ model: 'yolox' })
    expect(configuredObjectModel('yolox_tiny')).toEqual({ model: 'yolox_tiny' })
    expect(configuredObjectModel('efficientdet_lite0')).toEqual({ model: 'efficientdet_lite0' })
    expect(configuredObjectModel('yolov8')).toHaveProperty('error')
  })

  it('tries YOLOX-S on WebGPU first and never runs YOLOX-S on the CPU in the default mode', () => {
    expect(yoloxAttempts('yolox', true)).toEqual([
      { model: 'yolox_s', provider: 'webgpu' },
      { model: 'yolox_tiny', provider: 'webgpu' },
      { model: 'yolox_tiny', provider: 'wasm' },
    ])
    expect(yoloxAttempts('yolox', false)).toEqual([{ model: 'yolox_tiny', provider: 'wasm' }])
    expect(yoloxAttempts('efficientdet_lite0', true)).toEqual([])
  })
})

describe('small-object tiling', () => {
  it('looks at the whole frame plus one rotating tile on WebGPU', () => {
    expect(regionsFor(0, 'webgpu')).toEqual([FULL_FRAME, TILES[0]])
    expect(regionsFor(3, 'webgpu')).toEqual([FULL_FRAME, TILES[3]])
    expect(regionsFor(4, 'webgpu')).toEqual([FULL_FRAME, TILES[0]])
  })

  it('on the CPU, runs every other frame, alternating the whole frame and the next tile', () => {
    const plan = Array.from({ length: 10 }, (_, i) => regionsFor(i, 'wasm'))
    expect(plan).toEqual([[FULL_FRAME], [], [TILES[0]], [], [FULL_FRAME], [], [TILES[1]], [], [FULL_FRAME], []])
    expect(regionsFor(14, 'wasm')).toEqual([TILES[3]])
  })

  it('EfficientDet looks at the whole frame every frame', () => {
    expect(regionsFor(7, 'mediapipe')).toEqual([FULL_FRAME])
  })

  it('the four tiles cover the frame with overlap', () => {
    for (const x of [0, 0.39, 0.5, 0.61, 0.99]) {
      for (const y of [0, 0.39, 0.5, 0.61, 0.99]) {
        expect(TILES.some((t) => x >= t.x && x <= t.x + t.width && y >= t.y && y <= t.y + t.height)).toBe(true)
      }
    }
    // A point in the middle is inside every tile; the seams overlap by 0.2 of the frame.
    expect(TILES.every((t) => 0.5 >= t.x && 0.5 <= t.x + t.width)).toBe(true)
  })

  it('maps a box found in a tile back onto the frame, and a tile to pixels', () => {
    const mapped = toFrame({ x: 0.5, y: 0.5, width: 0.1, height: 0.2 }, TILES[3]!)
    expect(mapped.x).toBeCloseTo(0.7)
    expect(mapped.y).toBeCloseTo(0.7)
    expect(mapped.width).toBeCloseTo(0.06)
    expect(mapped.height).toBeCloseTo(0.12)
    expect(pixelRect(TILES[3]!, 1280, 720)).toEqual({ sx: 512, sy: 288, sw: 768, sh: 432 })
    expect(pixelRect(FULL_FRAME, 640, 360)).toEqual({ sx: 0, sy: 0, sw: 640, sh: 360 })
  })

  it('keeps an object seen in both the frame and a tile once, at its higher score', () => {
    const full = { score: 0.4, box: { x: 0.6, y: 0.6, width: 0.1, height: 0.1 } }
    const tile = { score: 0.7, box: { x: 0.61, y: 0.61, width: 0.08, height: 0.08 } } // inside the full-frame box
    const elsewhere = { score: 0.3, box: { x: 0.1, y: 0.1, width: 0.05, height: 0.05 } }
    expect(mergeRegions([full, tile, elsewhere], 0.45, 3)).toEqual([tile, elsewhere])
  })
})

describe('YOLOX preprocessing', () => {
  it('letterboxes aspect-preserving at the top-left', () => {
    expect(letterbox(640, 480, 416)).toEqual({ size: 416, scale: 0.65, width: 416, height: 312 })
    expect(letterbox(480, 640, 416)).toMatchObject({ width: 312, height: 416 })
  })

  it('packs NCHW in BGR order with raw 0..255 values (no normalisation)', () => {
    // 2×2 image: pixel i has R=10+i, G=20+i, B=30+i.
    const rgba = [10, 20, 30, 255, 11, 21, 31, 255, 12, 22, 32, 255, 13, 23, 33, 255]
    expect([...toBgrTensor(rgba, 2)]).toEqual([30, 31, 32, 33, 20, 21, 22, 23, 10, 11, 12, 13])
  })
})

describe('YOLOX postprocessing', () => {
  const box = letterbox(640, 480, 416)

  it('decodes grid/stride boxes back into the source frame and scores objectness × class', () => {
    // Stride-8 level, grid 52×52, row-major: anchor (gx=10, gy=5) = 5·52 + 10.
    const anchor = 5 * 52 + 10
    const out = outputWith(anchor, { cx: 0.5, cy: 0.5, w: Math.log(4), h: Math.log(2), obj: 0.9, cls: { 67: 0.8 } })
    const candidates = decodeClass(out, STRIDE, 67, YOLOX_TINY.strides, box, 640, 480)
    expect(candidates).toHaveLength(3549)
    const best = nms(candidates, YOLOX_TINY.nmsIou, 1)[0]!
    expect(best.score).toBeCloseTo(0.72)
    // centre (0.5+10)·8 = 84, (0.5+5)·8 = 44 input px; size 32×16 input px; ÷ 0.65 → source px.
    expect(best.box.x).toBeCloseTo((84 - 16) / 0.65 / 640, 5)
    expect(best.box.y).toBeCloseTo((44 - 8) / 0.65 / 480, 5)
    expect(best.box.width).toBeCloseTo(32 / 0.65 / 640, 5)
    expect(best.box.height).toBeCloseTo(16 / 0.65 / 480, 5)
  })

  it('walks the levels in stride order (8, 16, 32)', () => {
    const firstOfStride16 = 52 * 52 // 2704
    const out = outputWith(firstOfStride16, { cx: 0, cy: 0, w: 0, h: 0, obj: 1, cls: { 67: 1 } })
    const best = nms(decodeClass(out, STRIDE, 67, YOLOX_TINY.strides, box, 640, 480), 0.45, 1)[0]!
    // grid (0,0) at stride 16: centre 0, size e⁰·16 = 16 → clipped at the frame edge.
    expect(best.box.x).toBe(0)
    expect(best.box.width).toBeCloseTo(8 / 0.65 / 640, 5)
  })

  it('decodes several classes from one output, each from its own column', () => {
    const out = outputWith(100, { cx: 0, cy: 0, w: 0, h: 0, obj: 0.5, cls: { 67: 0.8, 73: 0.4, 63: 0 } })
    const decoded = decodeClasses(out, STRIDE, [67, 73, 63, 65], YOLOX_TINY.strides, box, 640, 480, 0.01)
    expect(decoded.get(67)).toHaveLength(1)
    expect(decoded.get(67)![0]!.score).toBeCloseTo(0.4)
    expect(decoded.get(73)).toHaveLength(1)
    expect(decoded.get(73)![0]!.score).toBeCloseTo(0.2)
    expect(decoded.get(63)).toEqual([]) // below the decode floor: dropped
    expect(decoded.get(65)).toEqual([])
    // The same anchor has the same box for every class.
    expect(decoded.get(67)![0]!.box).toEqual(decoded.get(73)![0]!.box)
  })

  it('reads the cell-phone column only', () => {
    const anchor = 100
    const out = outputWith(anchor, { cx: 0, cy: 0, w: 0, h: 0, obj: 1, cls: { 66: 0.99, 68: 0.99 } })
    expect(Math.max(...decodeClass(out, STRIDE, 67, YOLOX_TINY.strides, box, 640, 480).map((c) => c.score))).toBe(0)
  })

  it('suppresses overlapping boxes, keeps separate ones, and applies no score threshold', () => {
    const a = { score: 0.9, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }
    const overlapping = { score: 0.8, box: { x: 0.11, y: 0.1, width: 0.2, height: 0.2 } }
    const separate = { score: 0.05, box: { x: 0.6, y: 0.6, width: 0.1, height: 0.1 } }
    expect(nms([overlapping, separate, a], 0.45, 5)).toEqual([a, separate])
    expect(nms([overlapping, separate, a], 0.45, 1)).toEqual([a])
    expect(nms([separate], 0.45, 1)).toEqual([separate]) // a low score is still reported, as raw confidence
  })
})

describe('object model selection and reporting', () => {
  const globals = globalThis as { Worker?: unknown; __assessxAI?: unknown }
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    delete globals.Worker
    delete globals.__assessxAI
  })

  it('production defaults to the yolox mode; the seam can choose another', () => {
    globals.Worker = class {}
    expect((selectComponents().runtime as MediaPipeRuntime).objectModel).toBe('yolox')
    globals.__assessxAI = { objectModel: 'yolox_tiny' }
    expect((selectComponents().runtime as MediaPipeRuntime).objectModel).toBe('yolox_tiny')
  })

  it('sends the YOLOX configuration (both models, integrity digests, runtime path, WebGPU preference) to the worker', async () => {
    const posted: WorkerRequest[] = []
    let onmessage: ((e: MessageEvent) => void) | null = null
    const fakeWorker = {
      postMessage: (m: WorkerRequest) => posted.push(m),
      terminate() {},
      addEventListener() {},
      removeEventListener() {},
      set onmessage(h: ((e: MessageEvent) => void) | null) {
        onmessage = h
      },
    }
    const runtime = new MediaPipeRuntime({ createWorker: () => fakeWorker as unknown as Worker, origin: 'http://tauri.localhost' })
    const loading = runtime.load()
    const load = posted[0]!
    expect(load.type).toBe('load')
    if (load.type === 'load') {
      expect(load.config.objectModel).toBe('yolox')
      expect(load.config.objectCategories).toEqual(['cell phone', 'book', 'laptop', 'remote'])
      expect(load.config.yolox).toMatchObject({
        models: {
          yolox_s: { url: 'http://tauri.localhost/models/yolox_s.onnx', sha256: YOLOX_S.sha256 },
          yolox_tiny: { url: 'http://tauri.localhost/models/yolox_tiny.onnx', sha256: YOLOX_TINY.sha256 },
        },
        wasmPaths: 'http://tauri.localhost/onnxruntime/',
        preferWebGPU: true,
      })
    }
    const report = { model: 'yolox_tiny' as const, accelerator: 'webgpu', loadMs: 900, warmupMs: 3000, firstInferenceMs: 45, fallback: null }
    ;(onmessage as unknown as (e: MessageEvent) => void)({
      data: { type: 'loaded', tasks: { faceDetector: 'READY', faceLandmarker: 'READY', objectDetector: 'READY' }, accelerator: 'CPU', objectBackend: report, errors: [] },
    } as MessageEvent)
    await loading
    expect(runtime.info.objectDetector).toEqual(report)
  })

  it('every object observation names its class, the model that produced it, its size and region', async () => {
    const detector = new PhoneDetector()
    await detector.init()
    const observations = detector.process(
      frame(),
      raw(
        payload({
          objectModel: 'yolox_s',
          objects: [
            { category: 'cell phone', score: 0.42, box: { x: 0, y: 0, width: 0.1, height: 0.2 }, region: 'tile' },
            { category: 'cell phone', score: 0.3, box: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, region: 'full' },
          ],
        }),
      ),
    )
    expect(observations.map((o) => o.metadata.objectClass)).toEqual(['cell_phone', 'book', 'laptop', 'remote'])
    expect(observations[0]?.metadata).toEqual({ objectClass: 'cell_phone', objectModel: 'yolox_s', boxAreaRatio: 0.02, region: 'tile' })
    expect(observations[0]?.confidence).toBe(0.42) // the best candidate
    expect(observations[1]).toMatchObject({ confidence: 0, metadata: { objectClass: 'book', objectModel: 'yolox_s' } }) // none seen
  })

  it('a frame the object model skipped produces no object observation (unknown, never none)', async () => {
    const detector = new PhoneDetector()
    await detector.init()
    const skipped = payload({ objectModel: 'yolox_tiny', objects: null })
    skipped.tasks.objectDetector = 'SKIPPED'
    expect(detector.process(frame(), raw(skipped))).toEqual([])
    expect(detector.state).toBe('RUNNING') // skipping is healthy, not a failure
  })
})
