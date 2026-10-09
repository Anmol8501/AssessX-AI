import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INFERENCE_TIMEOUT_MS, LOAD_TIMEOUT_MS } from '../mediapipe/config'
import type { WorkerRequest, WorkerResponse } from '../mediapipe/protocol'
import { MediaPipeRuntime } from '../mediapipe/runtime'
import { frame, payload } from './fixtures'

/** A scripted stand-in for the inference worker. */
class FakeWorker {
  static instances: FakeWorker[] = []
  posted: { message: WorkerRequest; transfer: Transferable[] }[] = []
  terminated = false
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  private listeners: ((event: MessageEvent<WorkerResponse>) => void)[] = []
  constructor() {
    FakeWorker.instances.push(this)
  }
  postMessage(message: WorkerRequest, transfer: Transferable[] = []) {
    this.posted.push({ message, transfer })
  }
  addEventListener(_type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void) {
    this.listeners.push(listener)
  }
  removeEventListener(_type: 'message', listener: (event: MessageEvent<WorkerResponse>) => void) {
    this.listeners = this.listeners.filter((l) => l !== listener)
  }
  terminate() {
    this.terminated = true
  }
  reply(data: WorkerResponse) {
    const event = { data } as MessageEvent<WorkerResponse>
    this.onmessage?.(event)
    for (const listener of this.listeners) listener(event)
  }
}

const LOADED: WorkerResponse = {
  type: 'loaded',
  tasks: { faceDetector: 'READY', faceLandmarker: 'READY', objectDetector: 'READY', poseLandmarker: 'READY' },
  accelerator: 'CPU',
  objectBackend: { model: 'efficientdet_lite0', accelerator: 'CPU', loadMs: 10, warmupMs: null, firstInferenceMs: null, fallback: null },
  errors: [],
}
const bitmapFrame = (id = 1) => ({ ...frame(id), bitmap: { close() {} } as unknown as ImageBitmap })

function runtime() {
  FakeWorker.instances = []
  return new MediaPipeRuntime({ createWorker: () => new FakeWorker() as unknown as Worker, origin: 'http://tauri.localhost' })
}
const worker = () => FakeWorker.instances.at(-1)!

async function loaded() {
  const r = runtime()
  const loading = r.load()
  worker().reply(LOADED)
  await loading
  return r
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('MediaPipe runtime', () => {
  it('loads once from the app’s own origin and reports the accelerator actually used', async () => {
    const r = await loaded()
    expect(r.state).toBe('READY')
    expect(r.info).toMatchObject({ kind: 'mediapipe', productionCapable: true, accelerator: 'CPU' })
    const load = worker().posted[0]!.message
    expect(load.type).toBe('load')
    if (load.type === 'load') {
      expect(load.config.models.faceLandmarker).toBe('http://tauri.localhost/models/face_landmarker.task')
      expect(load.config.objectCategories).toEqual(['cell phone', 'book', 'laptop', 'remote'])
      expect(load.config.preferGpu).toBe(false)
    }
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('reports LOAD_FAILED and releases the worker when no model loads, or loading hangs', async () => {
    const failing = runtime()
    const attempt = failing.load()
    worker().reply({ type: 'load-failed', error: 'no models' })
    await expect(attempt).rejects.toThrow('no models')
    expect(failing.state).toBe('LOAD_FAILED')
    expect(worker().terminated).toBe(true)

    const hanging = runtime()
    const stuck = hanging.load()
    const assertion = expect(stuck).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS)
    await assertion
    expect(hanging.state).toBe('LOAD_FAILED')
    expect(worker().terminated).toBe(true)
  })

  it('transfers the frame’s pixels to the worker and returns its result', async () => {
    const r = await loaded()
    const f = bitmapFrame(7)
    const inference = r.infer(f)
    const sent = worker().posted[1]!
    expect(sent.message.type).toBe('infer')
    expect(sent.transfer).toEqual([f.bitmap]) // moved, not copied
    if (sent.message.type === 'infer') worker().reply({ type: 'result', id: sent.message.id, payload: payload() })
    const raw = await inference
    expect(raw.frameId).toBe(7)
    expect(raw.timingsMs).toMatchObject({ total: 3 })
    expect(r.state).toBe('RUNNING')
  })

  it('refuses a frame without pixels instead of guessing', async () => {
    const r = await loaded()
    await expect(r.infer(frame())).rejects.toThrow('no pixel data')
    expect(worker().posted).toHaveLength(1) // nothing was sent
  })

  it('a hung inference terminates the worker and reports ERROR; a late reply is ignored', async () => {
    const r = await loaded()
    const hung = r.infer(bitmapFrame())
    const assertion = expect(hung).rejects.toThrow(/timed out|stopped/)
    await vi.advanceTimersByTimeAsync(INFERENCE_TIMEOUT_MS)
    await assertion
    expect(r.state).toBe('ERROR')
    const dead = worker()
    expect(dead.terminated).toBe(true)
    expect(() => dead.reply({ type: 'result', id: 1, payload: payload() })).not.toThrow()
    await expect(r.infer(bitmapFrame(2))).rejects.toThrow(/not ready/)
  })

  it('a worker crash is reported as ERROR, never as a result', async () => {
    const r = await loaded()
    const pending = r.infer(bitmapFrame())
    worker().onerror?.({ message: 'wasm abort' } as ErrorEvent)
    await expect(pending).rejects.toThrow(/wasm abort/)
    expect(r.state).toBe('ERROR')
  })

  it('unload disposes the models and always terminates the worker', async () => {
    const r = await loaded()
    const unloading = r.unload()
    worker().reply({ type: 'disposed' })
    await unloading
    expect(worker().posted.at(-1)!.message.type).toBe('dispose')
    expect(worker().terminated).toBe(true)
    expect(r.state).toBe('STOPPED')

    const stubborn = await loaded() // a worker that never confirms is still terminated
    const stopping = stubborn.unload()
    await vi.advanceTimersByTimeAsync(2_000)
    await stopping
    expect(worker().terminated).toBe(true)
    expect(stubborn.state).toBe('STOPPED')
  })
})
