import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PhoneDetector } from '../detectors/object'
import type { WorkerRequest } from '../mediapipe/protocol'
import { MediaPipeRuntime } from '../mediapipe/runtime'
import { configuredObjectModel, DEFAULT_OBJECT_MODEL, YOLOX_TINY } from '../objectDetection/models'
import { anchorCount, decodeClass, letterbox, nms, toBgrTensor } from '../objectDetection/yolox'
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

describe('YOLOX-Tiny contract', () => {
  it('the pinned signature is internally consistent', () => {
    expect(anchorCount(YOLOX_TINY.size, YOLOX_TINY.strides)).toBe(YOLOX_TINY.output.shape[1]) // 3549
    expect(YOLOX_TINY.input.shape).toEqual([1, 3, 416, 416])
    expect(STRIDE).toBe(5 + 80)
    expect(YOLOX_TINY.classIndex).toBe(67)
    expect(YOLOX_TINY.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('selects EfficientDet-Lite0 unless YOLOX is explicitly configured, and rejects unknown values', () => {
    expect(configuredObjectModel(undefined)).toEqual({ model: DEFAULT_OBJECT_MODEL })
    expect(configuredObjectModel('  ')).toEqual({ model: 'efficientdet_lite0' })
    expect(configuredObjectModel('yolox_tiny')).toEqual({ model: 'yolox_tiny' })
    expect(configuredObjectModel('yolox')).toHaveProperty('error')
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

  it('production defaults to EfficientDet-Lite0; the seam can opt into YOLOX-Tiny', () => {
    globals.Worker = class {}
    expect((selectComponents().runtime as MediaPipeRuntime).objectModel).toBe('efficientdet_lite0')
    globals.__assessxAI = { objectModel: 'yolox_tiny' }
    expect((selectComponents().runtime as MediaPipeRuntime).objectModel).toBe('yolox_tiny')
  })

  it('sends the YOLOX configuration (integrity digest, runtime path, WebGPU preference) to the worker', async () => {
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
    const runtime = new MediaPipeRuntime({ createWorker: () => fakeWorker as unknown as Worker, origin: 'http://tauri.localhost', objectModel: 'yolox_tiny' })
    const loading = runtime.load()
    const load = posted[0]!
    expect(load.type).toBe('load')
    if (load.type === 'load') {
      expect(load.config.objectModel).toBe('yolox_tiny')
      expect(load.config.yolox).toMatchObject({
        modelUrl: 'http://tauri.localhost/models/yolox_tiny.onnx',
        sha256: YOLOX_TINY.sha256,
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

  it('every phone observation names the model that produced it', async () => {
    const detector = new PhoneDetector()
    await detector.init()
    const [observation] = detector.process(frame(), raw(payload({ objectModel: 'yolox_tiny', objects: [{ category: 'cell phone', score: 0.42, box: { x: 0, y: 0, width: 0.1, height: 0.1 } }] })))
    expect(observation?.metadata).toEqual({ objectClass: 'cell_phone', objectModel: 'yolox_tiny' })
    expect(observation?.confidence).toBe(0.42)
  })
})
