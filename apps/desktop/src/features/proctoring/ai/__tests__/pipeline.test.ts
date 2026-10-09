import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FacePresenceDetector } from '../detectors/face'
import type { FrameSource } from '../frameProvider'
import { AIPipeline } from '../pipeline'
import { FrameScheduler } from '../scheduler'
import { selectComponents } from '../seam'
import { MockAIRuntime, MockDetector } from '../testRuntime'
import type { AIPipelineView, Detector, Frame, Observation, RawInference } from '../types'
import { frame } from './fixtures'

const CONFIG = { inferenceIntervalMs: 100, latencyBudgetMs: 10_000, rollingWindow: 10 }
const liveStream = () => ({ getVideoTracks: () => [{ readyState: 'live' }] }) as unknown as MediaStream

/** A scripted frame source standing in for the camera; records what happened to it. */
function sources() {
  const created: (FrameSource & { stopped: boolean; frames: ReturnType<typeof frame>[] })[] = []
  let id = 0
  const factory = () => {
    const source = {
      stopped: false,
      frames: [] as ReturnType<typeof frame>[],
      start: async () => undefined,
      capture: async () => {
        if (source.stopped) return null
        const next = frame(++id, id * 100)
        source.frames.push(next)
        return next
      },
      stop: () => {
        source.stopped = true
      },
    }
    created.push(source)
    return source
  }
  return { created, factory }
}

function lastView(pipeline: AIPipeline): () => AIPipelineView {
  let view: AIPipelineView = pipeline.getView()
  pipeline.subscribe((next) => (view = next))
  return () => view
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('frame scheduler', () => {
  it('keeps at most one frame in flight and samples again only after it finishes', async () => {
    let finish: () => void = () => undefined
    const captured: Frame[] = []
    const scheduler = new FrameScheduler(CONFIG, {
      capture: async () => {
        const next = frame(captured.length + 1)
        captured.push(next)
        return next
      },
      process: () => new Promise<void>((resolve) => (finish = resolve)),
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(captured).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000) // inference is slow: nothing else is captured or queued
    expect(captured).toHaveLength(1)
    finish()
    await vi.advanceTimersByTimeAsync(100)
    expect(captured).toHaveLength(2)
    expect(scheduler.getStats().framesProcessed).toBe(1)
    expect(scheduler.getStats().framesDropped).toBe(0)
    scheduler.stop()
  })

  it('releases every frame, including when processing fails, and counts unavailable ticks', async () => {
    const produced: ReturnType<typeof frame>[] = []
    let call = 0
    const scheduler = new FrameScheduler(CONFIG, {
      capture: async () => {
        call++
        if (call === 2) return null // camera had no frame this time
        const next = frame(call)
        produced.push(next)
        return next
      },
      process: async (f) => {
        if (f.frameId === 3) throw new Error('inference failed')
      },
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(400)
    scheduler.stop()
    expect(produced.length).toBeGreaterThanOrEqual(2)
    expect(produced.every((f) => f.closed)).toBe(true)
    const stats = scheduler.getStats()
    expect(stats.framesUnavailable).toBe(1)
    expect(stats.framesCaptured).toBe(produced.length)
    expect(stats.framesProcessed).toBe(produced.length - 1) // the failed one is not "processed"
  })

  it('stops cleanly: no further ticks, and an in-flight frame does not reschedule', async () => {
    let finish: () => void = () => undefined
    let captures = 0
    const scheduler = new FrameScheduler(CONFIG, {
      capture: async () => frame(++captures),
      process: () => new Promise<void>((resolve) => (finish = resolve)),
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(100)
    scheduler.stop()
    finish()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(captures).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('measures latency with the injected clock', async () => {
    let now = 0
    const scheduler = new FrameScheduler(CONFIG, {
      capture: async () => frame(),
      process: async () => {
        now += 40
      },
      now: () => now,
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(100)
    scheduler.stop()
    expect(scheduler.getStats().lastLatencyMs).toBe(40)
  })
})

describe('AI pipeline', () => {
  it('runs frames through the runtime into observations, then stops and releases everything', async () => {
    const { created, factory } = sources()
    const runtime = new MockAIRuntime()
    const detector = new MockDetector()
    const pipeline = new AIPipeline({ runtime, detectors: [detector] }, CONFIG, factory)
    const view = lastView(pipeline)

    await pipeline.start(liveStream())
    await vi.advanceTimersByTimeAsync(350)
    expect(view().health.state).toBe('RUNNING')
    expect(view().telemetry.framesProcessed).toBeGreaterThan(0)
    expect(view().recentObservations.some((o) => o.observationType === 'FRAME_OBSERVED')).toBe(true)
    expect(created).toHaveLength(1)

    await pipeline.stop()
    expect(created[0]?.stopped).toBe(true)
    expect(runtime.state).toBe('STOPPED')
    expect(detector.state).toBe('STOPPED')
    expect(view().health.state).toBe('STOPPED')
    expect(created[0]?.frames.every((f) => f.closed)).toBe(true)
    const processed = view().telemetry.framesProcessed
    await vi.advanceTimersByTimeAsync(1_000)
    expect(view().telemetry.framesProcessed).toBe(processed) // nothing runs after stop
  })

  it('never touches the camera when the model fails to load, and reports ERROR', async () => {
    const { created, factory } = sources()
    const pipeline = new AIPipeline({ runtime: new MockAIRuntime({ loadFails: true }), detectors: [] }, CONFIG, factory)
    const view = lastView(pipeline)
    await pipeline.start(liveStream())
    await vi.advanceTimersByTimeAsync(500)
    expect(created).toHaveLength(0)
    expect(view().health.state).toBe('ERROR')
    expect(view().health.runtimeState).toBe('LOAD_FAILED')
  })

  it('stops sampling once the runtime fails, keeping the telemetry it had', async () => {
    const { created, factory } = sources()
    const pipeline = new AIPipeline({ runtime: new MockAIRuntime({ inferFailsAfter: 1 }), detectors: [new MockDetector()] }, CONFIG, factory)
    const view = lastView(pipeline)
    await pipeline.start(liveStream())
    await vi.advanceTimersByTimeAsync(1_000)
    expect(view().health.state).toBe('ERROR')
    expect(created[0]?.stopped).toBe(true)
    expect(created[0]?.frames).toHaveLength(2) // one processed, one failed — then no more captures
    expect(view().telemetry.framesProcessed).toBe(1)
  })

  it('reports DEGRADED with no runtime and leaves the camera untouched', async () => {
    const { created, factory } = sources()
    const pipeline = new AIPipeline({ runtime: null, detectors: [] }, CONFIG, factory)
    const view = lastView(pipeline)
    await pipeline.start(liveStream())
    expect(created).toHaveLength(0)
    expect(view().health.state).toBe('DEGRADED')
  })

  it('resets detector state when the camera changes, and reports a lost camera', async () => {
    const { created, factory } = sources()
    const detector = new MockDetector()
    const reset = vi.fn()
    ;(detector as Detector).reset = reset
    const pipeline = new AIPipeline({ runtime: new MockAIRuntime(), detectors: [detector] }, CONFIG, factory)
    const view = lastView(pipeline)
    const first = liveStream()
    await pipeline.start(first)
    pipeline.setStream(first) // same stream: no reset
    expect(reset).not.toHaveBeenCalled()

    pipeline.setStream(null) // camera lost
    expect(reset).toHaveBeenCalledTimes(1)
    expect(created[0]?.stopped).toBe(true)
    expect(view().health.state).toBe('DEGRADED')

    pipeline.setStream(liveStream()) // reconnected: a fresh source, running again
    expect(reset).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(250)
    expect(created).toHaveLength(2)
    expect(view().health.state).toBe('RUNNING')
    await pipeline.stop()
  })

  it('isolates a failing detector from the others', async () => {
    const { factory } = sources()
    const broken: Detector = {
      id: 'broken',
      version: '0',
      state: 'RUNNING',
      init: async () => undefined,
      process: () => {
        throw new Error('boom')
      },
      shutdown: async () => undefined,
    }
    const pipeline = new AIPipeline({ runtime: new MockAIRuntime(), detectors: [broken, new MockDetector()] }, CONFIG, factory)
    const view = lastView(pipeline)
    await pipeline.start(liveStream())
    await vi.advanceTimersByTimeAsync(250)
    expect(view().recentObservations.some((o: Observation) => o.detectorId === 'mock.frame-observer')).toBe(true)
    await pipeline.stop()
  })

  it('emits nothing for a frame whose inference finishes after the exam ended', async () => {
    const { factory } = sources()
    let release: (value: RawInference) => void = () => undefined
    const runtime = new MockAIRuntime()
    runtime.infer = (f: Frame) => new Promise<RawInference>((resolve) => (release = () => resolve({ frameId: f.frameId, monotonicTs: 0, payload: {} })))
    const pipeline = new AIPipeline({ runtime, detectors: [new MockDetector()] }, CONFIG, factory)
    const view = lastView(pipeline)
    await pipeline.start(liveStream())
    await vi.advanceTimersByTimeAsync(100) // a frame is now in inference
    await pipeline.stop()
    release({ frameId: 1, monotonicTs: 0, payload: {} })
    await vi.advanceTimersByTimeAsync(100)
    expect(view().recentObservations).toHaveLength(0)
    expect(view().health.state).toBe('STOPPED')
  })
})

describe('runtime selection', () => {
  const globals = globalThis as { Worker?: unknown; __assessxAI?: unknown }
  afterEach(() => {
    delete globals.Worker
    delete globals.__assessxAI
  })

  it('production selects the real MediaPipe runtime and detectors — never the mock', () => {
    globals.Worker = class {}
    const { runtime, detectors } = selectComponents()
    expect(runtime?.info.kind).toBe('mediapipe')
    expect(runtime?.info.productionCapable).toBe(true)
    expect(runtime).not.toBeInstanceOf(MockAIRuntime)
    expect(detectors.map((d) => d.id)).toEqual([
      'mediapipe.face-presence',
      'mediapipe.face-tracking',
      'mediapipe.head-pose',
      'mediapipe.gaze',
      'object-detection',
      'frame-quality',
      'framing',
    ])
    expect(detectors.some((d) => d instanceof MockDetector)).toBe(false)
  })

  it('without Web Worker support there is no runtime (reported, not faked)', () => {
    expect(selectComponents().runtime).toBeNull()
  })

  it('the mock is reachable only through the test seam and is marked non-production', () => {
    globals.Worker = class {}
    globals.__assessxAI = { mock: {} }
    const { runtime, detectors } = selectComponents()
    expect(runtime).toBeInstanceOf(MockAIRuntime)
    expect(runtime?.info.productionCapable).toBe(false)
    expect(detectors[0]).toBeInstanceOf(MockDetector)
  })

  it('the seam can keep the real runtime while tuning the sampling interval', () => {
    globals.Worker = class {}
    globals.__assessxAI = { config: { inferenceIntervalMs: 50 } }
    const selected = selectComponents()
    expect(selected.runtime?.info.kind).toBe('mediapipe')
    expect(selected.config).toEqual({ inferenceIntervalMs: 50 })
    expect(selected.detectors.some((d) => d instanceof FacePresenceDetector)).toBe(true)
  })
})
