import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordingPolicy } from '@/features/assessments/types'
import { EvidenceCoordinator, isEligible } from '../coordinator'
import { NO_RECORDING_NOTICE, recordingNotice } from '../notice'
import { CaptureError, RollingRecorder, type RecorderLike } from '../rollingRecorder'

const POLICY: RecordingPolicy = {
  enabled: true,
  event_types: ['FACE_NOT_DETECTED', 'MULTIPLE_FACES_DETECTED'],
  pre_seconds: 5,
  post_seconds: 10,
  max_clip_seconds: 30,
  max_clip_bytes: 50_000,
  video_bits_per_second: 250_000,
  max_width: 640,
  max_height: 360,
  frame_rate: 10,
  retention_days: 30,
}

/** A MediaRecorder stand-in: emits one 1 kB chunk per second while recording. */
class FakeRecorder implements RecorderLike {
  static all: FakeRecorder[] = []
  state: RecorderLike['state'] = 'inactive'
  ondataavailable: RecorderLike['ondataavailable'] = null
  onstop: RecorderLike['onstop'] = null
  onerror: RecorderLike['onerror'] = null
  timer: ReturnType<typeof setInterval> | null = null
  readonly chunkBytes: number
  constructor(chunkBytes = 1000) {
    this.chunkBytes = chunkBytes
    FakeRecorder.all.push(this)
  }
  start() {
    this.state = 'recording'
    this.timer = setInterval(() => this.ondataavailable?.({ data: new Blob([new Uint8Array(this.chunkBytes)]) }), 1000)
  }
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    if (this.timer) clearInterval(this.timer)
    this.ondataavailable?.({ data: new Blob([new Uint8Array(this.chunkBytes)]) })
    queueMicrotask(() => this.onstop?.())
  }
}

function recorder(policy = POLICY, chunkBytes = 1000) {
  return new RollingRecorder({
    policy,
    stream: {} as MediaStream,
    mimeType: 'video/webm',
    factory: () => new FakeRecorder(chunkBytes),
    now: () => Date.now(),
  })
}

describe('RollingRecorder — the bounded pre-event buffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T10:00:00Z'))
    FakeRecorder.all = []
  })
  afterEach(() => vi.useRealTimers())

  it('keeps only a few overlapping segments however long it runs', () => {
    const r = recorder()
    r.start()
    for (let i = 0; i < 60; i++) vi.advanceTimersByTime(5000) // five minutes
    expect(r.segmentCount).toBeLessThanOrEqual(3)
    expect(FakeRecorder.all.filter((x) => x.state === 'recording').length).toBeLessThanOrEqual(3)
    r.stop()
    expect(FakeRecorder.all.every((x) => x.state === 'inactive')).toBe(true)
  })

  it('captures from a segment holding at least the pre-event seconds, through the post-event window', async () => {
    const r = recorder()
    r.start()
    vi.advanceTimersByTime(12_000)
    const capture = r.capture()!
    expect(capture).not.toBeNull()
    await vi.advanceTimersByTimeAsync(10_000)
    const clip = await capture
    // started 5–10 s before the event, ended 10 s after it
    expect(clip.durationMs).toBeGreaterThanOrEqual(15_000)
    expect(clip.durationMs).toBeLessThanOrEqual(20_000 + 1000)
    expect(clip.blob.size).toBeGreaterThan(0)
    expect(clip.blob.type).toBe('video/webm')
    r.stop()
  })

  it('an event during a capture shares that clip', () => {
    const r = recorder()
    r.start()
    vi.advanceTimersByTime(6000)
    const first = r.capture()
    vi.advanceTimersByTime(2000)
    expect(r.capture()).toBe(first)
    r.stop()
  })

  it('stopping finishes a capture in progress with what it has, and allows no new one', async () => {
    const r = recorder()
    r.start()
    vi.advanceTimersByTime(7000)
    const capture = r.capture()!
    vi.advanceTimersByTime(3000)
    r.stop()
    await vi.advanceTimersByTimeAsync(0)
    const clip = await capture
    expect(clip.durationMs).toBeLessThan(15_000) // cut short by the end of the exam
    expect(r.capture()).toBeNull()
  })

  it('a clip over the byte ceiling is refused, not uploaded', async () => {
    const r = recorder({ ...POLICY, max_clip_bytes: 5000 }, 4000)
    r.start()
    vi.advanceTimersByTime(1000)
    const capture = r.capture()!
    const settled = capture.then(
      () => 'resolved',
      (error: unknown) => (error instanceof CaptureError ? error.reason : 'other'),
    )
    await vi.advanceTimersByTimeAsync(12_000)
    expect(await settled).toBe('too_large')
    r.stop()
  })

  it('nothing to record from means no capture', () => {
    const r = new RollingRecorder({
      policy: POLICY,
      stream: {} as MediaStream,
      mimeType: 'video/webm',
      factory: () => {
        throw new Error('no camera')
      },
    })
    r.start()
    expect(r.capture()).toBeNull()
    r.stop()
  })
})

describe('EvidenceCoordinator — the server decides', () => {
  const event = (id: string, type = 'FACE_NOT_DETECTED', phase = 'started') => ({
    client_event_id: id,
    event_type: type,
    metadata: { phase, episode_id: 'e' },
    client_reported_at: '2026-10-06T10:00:00Z',
  })
  const clip = { blob: new Blob(['webm']), durationMs: 15_000 }

  it('only an eligible episode start captures', () => {
    expect(isEligible(POLICY, event('a'))).toBe(true)
    expect(isEligible(POLICY, event('a', 'FACE_NOT_DETECTED', 'resolved'))).toBe(false)
    expect(isEligible(POLICY, event('a', 'CAMERA_TOO_DARK'))).toBe(false)
    expect(isEligible({ ...POLICY, enabled: false }, event('a'))).toBe(false)
  })

  it('uploads to the clip id the server chose, and only when it asks', async () => {
    const upload = vi.fn(async () => {})
    const fail = vi.fn(async () => {})
    const c = new EvidenceCoordinator({ policy: POLICY, capture: () => Promise.resolve(clip), upload, fail })
    c.queued(event('one'))
    c.recorded(event('one'), { id: 's1', clip_request: { clip_id: 'server-clip', upload: true } })
    c.queued(event('two'))
    c.recorded(event('two'), { id: 's2', clip_request: { clip_id: 'server-clip', upload: false } }) // linked
    c.queued(event('three'))
    c.recorded(event('three'), { id: 's3', clip_request: null }) // no clip (cooldown, cap)
    await Promise.resolve()
    await Promise.resolve()
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenCalledWith('server-clip', clip)
    expect(fail).not.toHaveBeenCalled()
    expect(c.waiting).toBe(0)
  })

  it('reports a failure instead of uploading when the capture failed or never existed', async () => {
    const upload = vi.fn(async () => {})
    const fail = vi.fn(async () => {})
    const c = new EvidenceCoordinator({
      policy: POLICY,
      capture: () => Promise.reject(new CaptureError('recording_failed')),
      upload,
      fail,
    })
    c.queued(event('one'))
    c.recorded(event('one'), { id: 's', clip_request: { clip_id: 'c1', upload: true } })
    c.recorded(event('never-queued'), { id: 's', clip_request: { clip_id: 'c2', upload: true } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(upload).not.toHaveBeenCalled()
    expect(fail).toHaveBeenCalledWith('c1', 'recording_failed')
    expect(fail).toHaveBeenCalledWith('c2', 'capture_interrupted')
  })

  it('holds a bounded number of captures waiting for an answer', () => {
    const c = new EvidenceCoordinator({
      policy: POLICY,
      capture: () => Promise.resolve(clip),
      upload: async () => {},
      fail: async () => {},
      maxPending: 2,
    })
    for (const id of ['a', 'b', 'c', 'd']) c.queued(event(id))
    expect(c.waiting).toBe(2)
  })
})

describe('what the candidate is told', () => {
  it('says plainly what is and is not recorded, with the server’s numbers', () => {
    const text = recordingNotice(POLICY)
    expect(text).toContain('microphone is never recorded')
    expect(text).toContain('not recorded continuously')
    expect(text).toContain('without sound')
    expect(text).toContain('5 seconds before')
    expect(text).toContain('10 seconds after')
    expect(text).toContain('deleted after 30 days')
    expect(text).toMatch(/not a decision about you/)
    expect(text.toLowerCase()).not.toMatch(/cheat|guilt|proof|prove/)
  })

  it('keeps the no-recording statement when clips are off', () => {
    expect(recordingNotice({ ...POLICY, enabled: false })).toBe(NO_RECORDING_NOTICE)
    expect(recordingNotice(undefined)).toBe(NO_RECORDING_NOTICE)
  })
})
