import { describe, expect, it } from 'vitest'
import { createMediaPipeDetectors } from '../detectors'
import {
  AIEventProcessor,
  ConditionStabilizer,
  DEFAULT_AI_EVENT_CONFIG,
  DISABLED_EVENT_TYPES,
  HeadCalibrator,
  PRODUCED_EVENT_TYPES,
  aiStatusOf,
  calibrationYaw,
  readConditions,
  withOverrides,
  type ConditionTiming,
} from '../events'
import { ScriptedMediaPipeRuntime, type ScriptedScene } from '../testRuntime'
import type { AIPipelineView, Observation } from '../types'
import { frame } from './fixtures'

const T = DEFAULT_AI_EVENT_CONFIG.thresholds

function obs(observationType: string, metadata: Observation['metadata'], confidence: number | null = null): Observation {
  return {
    observationId: `${observationType}:1`,
    detectorId: 'x',
    detectorVersion: '1',
    observationType,
    monotonicTs: 0,
    wallClock: '2026-09-30T10:00:00.000Z',
    confidence,
    metadata,
  }
}

const face = (count: number, score = 0.93) => obs('FACE_PRESENCE', { facePresent: count > 0, faceCount: count }, score)
const head = (yawDeg: number, pitchDeg: number) => obs('HEAD_POSE', { yawDeg, pitchDeg, rollDeg: 0 })
const gaze = (h: number, v: number) => obs('GAZE', { gazeHorizontal: h, gazeVertical: v })
const quality = (meanLuminance: number, faceAreaRatio?: number) =>
  obs('FRAME_QUALITY', { meanLuminance, luminanceStdDev: 0.2, ...(faceAreaRatio !== undefined ? { faceAreaRatio } : {}) })
const normal = () => [face(1), head(2, 3), gaze(0.1, 0), quality(0.45, 0.12)]

// -- 1. reading conditions ---------------------------------------------------------------------------

describe('readConditions', () => {
  it('reads a normal frame as every condition absent', () => {
    const r = readConditions(normal(), T, 0) // neutral yaw calibrated at 0°
    for (const reading of Object.values(r)) expect(reading.state).toBe('absent')
  })

  it('reads no face as FACE_NOT_DETECTED, and head / gaze / face size as unknown — not "forward"', () => {
    const r = readConditions([face(0), quality(0.45)], T)
    expect(r.FACE_NOT_DETECTED.state).toBe('present')
    expect(r.MULTIPLE_FACES_DETECTED.state).toBe('absent')
    expect(r.HEAD_ORIENTATION_CHANGED.state).toBe('unknown')
    expect(r.GAZE_AWAY.state).toBe('unknown')
    expect(r.FACE_TOO_FAR.state).toBe('unknown')
    expect(r.FACE_TOO_CLOSE.state).toBe('unknown')
    expect(r.CAMERA_TOO_DARK.state).toBe('absent')
  })

  it('treats a missing face-detector result as unknown, never as no face', () => {
    const r = readConditions([quality(0.45)], T)
    expect(r.FACE_NOT_DETECTED.state).toBe('unknown')
    expect(r.MULTIPLE_FACES_DETECTED.state).toBe('unknown')
  })

  it('reports the face count and the model confidence for multiple faces', () => {
    const r = readConditions([face(3, 0.81), quality(0.45, 0.1)], T)
    expect(r.MULTIPLE_FACES_DETECTED).toEqual({
      state: 'present',
      metadata: { detector: 'face_presence', face_count: 3, confidence: 0.81 },
    })
  })

  it('reads head orientation as unknown until the neutral yaw is calibrated', () => {
    expect(readConditions([face(1), head(-45, 0)], T, null).HEAD_ORIENTATION_CHANGED.state).toBe('unknown')
  })

  it.each([
    [-10, 'absent'],
    [-2.5, 'absent'], // +7.5° around a −10° neutral
    [-17.5, 'absent'], // −7.5°
    [-27.9, 'absent'], // −17.9°: inside the 18° deviation
    [-30, 'present'], // −20°
    [10, 'present'], // +20°
  ])('with a −10° neutral, yaw %d° reads as %s', (yaw, state) => {
    expect(readConditions([face(1), head(yaw, 0)], T, -10).HEAD_ORIENTATION_CHANGED.state).toBe(state)
  })

  it('names the direction from the candidate’s own neutral and records it', () => {
    const right = readConditions([face(1), head(-31, 4)], T, -10).HEAD_ORIENTATION_CHANGED
    expect(right.metadata).toEqual({ detector: 'head_pose', direction: 'right', yaw_deg: -31, neutral_yaw_deg: -10, pitch_deg: 4 })
    // +20° absolute is not a turn for someone whose neutral is +10°: no global yaw limit applies
    expect(readConditions([face(1), head(20, 0)], T, 10).HEAD_ORIENTATION_CHANGED.state).toBe('absent')
    expect(readConditions([face(1), head(25, 0)], T, -10).HEAD_ORIENTATION_CHANGED.metadata.direction).toBe('left')
  })

  it.each([25, -25, 40, -40])('never treats pitch %d° (looking down / up) as a head turn', (pitch) => {
    expect(readConditions([face(1), head(-10, pitch)], T, -10).HEAD_ORIENTATION_CHANGED.state).toBe('absent')
  })

  it.each([
    [0.5, 0, 'left'],
    [-0.5, 0, 'right'],
    [0, 0.5, 'up'],
    [0, -0.5, 'down'],
  ])('reads gaze %d / %d as eyes turned %s', (h, v, direction) => {
    const r = readConditions([face(1), gaze(h, v)], T)
    expect(r.GAZE_AWAY.state).toBe('present')
    expect(r.GAZE_AWAY.metadata).toMatchObject({ direction, gaze_horizontal: h, gaze_vertical: v })
  })

  it('reads the camera and face-size conditions from frame quality', () => {
    expect(readConditions([face(1), quality(0.05, 0.1)], T).CAMERA_TOO_DARK.metadata).toEqual({
      detector: 'frame_quality',
      mean_luminance: 0.05,
    })
    expect(readConditions([face(1), quality(0.4, 0.005)], T).FACE_TOO_FAR.state).toBe('present')
    expect(readConditions([face(1), quality(0.4, 0.029)], T).FACE_TOO_FAR.state).toBe('present')
    expect(readConditions([face(1), quality(0.4, 0.031)], T).FACE_TOO_FAR.state).toBe('absent')
    // the smallest face area measured when a candidate moved far back on a real webcam
    expect(readConditions([face(1), quality(0.4, 0.049)], T).FACE_TOO_FAR.state).toBe('absent')
    expect(readConditions([face(1), quality(0.4, 0.6)], T).FACE_TOO_CLOSE.state).toBe('present')
  })

  it('ignores object detection entirely — no phone condition exists', () => {
    const phone = obs('OBJECT_DETECTION', { objectClass: 'cell phone', objectModel: 'efficientdet_lite0' }, 0.99)
    const r = readConditions([...normal(), phone], T)
    expect(Object.keys(r).sort()).toEqual(
      [
        'CAMERA_TOO_DARK',
        'FACE_NOT_DETECTED',
        'FACE_TOO_CLOSE',
        'FACE_TOO_FAR',
        'GAZE_AWAY',
        'HEAD_ORIENTATION_CHANGED',
        'MULTIPLE_FACES_DETECTED',
      ].sort(),
    )
    expect(JSON.stringify(r)).not.toMatch(/phone|object/i)
  })
})

// -- 1b. neutral head calibration ----------------------------------------------------------------------

describe('HeadCalibrator', () => {
  const config = DEFAULT_AI_EVENT_CONFIG.headCalibration // 5 samples within 8°, |yaw| ≤ 40°

  it('calibrates a candidate whose neutral yaw is −10° from a stable run', () => {
    const c = new HeadCalibrator(config)
    for (const [i, yaw] of [-10, -11, -9, -10.5, -9.5].entries()) c.offer(yaw, i * 800)
    expect(c.state).toEqual({ status: 'calibrated', neutralYawDeg: -10, calibratedAt: 3200 })
  })

  it('ignores missing, invalid and implausible readings — they break the run, never join it', () => {
    const c = new HeadCalibrator(config)
    for (const yaw of [-10, -10, -10, -10]) c.offer(yaw, 0)
    c.offer(null, 0) // no usable face / pose this frame
    expect(c.state).toEqual({ status: 'calibrating', stableSamples: 0 })
    for (const yaw of [Number.NaN, 75, -10, -10, -10, -10]) c.offer(yaw, 0)
    expect(c.neutralYawDeg).toBeNull() // only 4 consecutive usable readings
    c.offer(-10, 0)
    expect(c.neutralYawDeg).toBe(-10)
  })

  it('does not lock onto an unstable run or an outlier', () => {
    const c = new HeadCalibrator(config)
    for (const yaw of [-10, -10, 25, -10, -10]) c.offer(yaw, 0) // one outlier: spread 35°
    expect(c.neutralYawDeg).toBeNull()
    for (const yaw of [-10, -10, -10]) c.offer(yaw, 0) // the window slides past it
    expect(c.neutralYawDeg).toBe(-10)
  })

  it('keeps the neutral fixed once calibrated, whatever follows', () => {
    const c = new HeadCalibrator(config)
    for (const yaw of [-10, -10, -10, -10, -10]) c.offer(yaw, 0)
    for (let i = 0; i < 100; i++) c.offer(20, i) // a long, stable turn
    expect(c.neutralYawDeg).toBe(-10)
  })

  it('uses only frames with exactly one face and a head pose', () => {
    expect(calibrationYaw([face(1), head(-10, 0)])).toBe(-10)
    expect(calibrationYaw([face(2), head(-10, 0)])).toBeNull()
    expect(calibrationYaw([face(0)])).toBeNull()
    expect(calibrationYaw([face(1)])).toBeNull()
  })
})

// -- 2. temporal stabilisation -------------------------------------------------------------------------

const TIMING: ConditionTiming = {
  startAfterMs: 1000,
  minFrames: 3,
  resolveAfterMs: 1000,
  minClearFrames: 3,
  cooldownMs: 2000,
  unknownResolveMs: 3000,
}

function feed(s: ConditionStabilizer, states: [string, number][]) {
  return states.map(([state, at]) => s.update(state as 'present', at).kind)
}

describe('ConditionStabilizer', () => {
  it('never starts an episode from a single-frame spike', () => {
    const s = new ConditionStabilizer(TIMING)
    expect(feed(s, [['present', 0], ['absent', 500], ['absent', 1000], ['absent', 5000]])).not.toContain('start')
  })

  it('starts once the condition has held long enough over enough frames', () => {
    const s = new ConditionStabilizer(TIMING)
    expect(feed(s, [['present', 0], ['present', 500], ['present', 1000]])).toEqual(['none', 'none', 'start'])
    expect(s.active).toBe(true)
  })

  it('needs both the duration and the frame count', () => {
    const s = new ConditionStabilizer(TIMING)
    expect(feed(s, [['present', 0], ['present', 1500]])).toEqual(['none', 'none']) // 2 frames only
    expect(s.update('present', 1600).kind).toBe('start')
  })

  it('does not start from a flickering condition', () => {
    const s = new ConditionStabilizer(TIMING)
    const states: [string, number][] = []
    for (let i = 0; i < 20; i++) states.push([i % 2 ? 'absent' : 'present', i * 400])
    expect(feed(s, states)).not.toContain('start')
  })

  it('never starts or clears on unknown readings', () => {
    const s = new ConditionStabilizer(TIMING)
    expect(feed(s, [['unknown', 0], ['unknown', 2000], ['unknown', 9000]])).not.toContain('start')
    feed(s, [['present', 10000], ['present', 10500], ['present', 11000]])
    expect(feed(s, [['unknown', 11500], ['absent', 12000], ['unknown', 12100]])).toEqual(['none', 'none', 'none'])
    expect(s.active).toBe(true)
  })

  it('resolves as condition_cleared after a stable clear, then observes a cooldown', () => {
    const s = new ConditionStabilizer(TIMING)
    feed(s, [['present', 0], ['present', 500], ['present', 1000]])
    expect(s.update('absent', 1500)).toEqual({ kind: 'none' })
    expect(s.update('absent', 2000)).toEqual({ kind: 'none' })
    expect(s.update('absent', 2500)).toEqual({ kind: 'resolve', resolution: 'condition_cleared' })
    // cooldown: the condition returning at once does not begin a new episode until 4500
    expect(feed(s, [['present', 2600], ['present', 3600], ['present', 4400]])).not.toContain('start')
    expect(feed(s, [['present', 4500], ['present', 5000], ['present', 5500]])).toEqual(['none', 'none', 'start'])
  })

  it('a brief clear inside an episode does not end it', () => {
    const s = new ConditionStabilizer(TIMING)
    feed(s, [['present', 0], ['present', 500], ['present', 1000]])
    expect(feed(s, [['absent', 1500], ['absent', 2000], ['present', 2400], ['absent', 2800], ['absent', 3300]])).not.toContain(
      'resolve',
    )
  })

  it('resolves as measurement_unavailable when the condition cannot be measured for long', () => {
    const s = new ConditionStabilizer(TIMING)
    feed(s, [['present', 0], ['present', 500], ['present', 1000]])
    expect(s.update('unknown', 2000).kind).toBe('none')
    expect(s.update('unknown', 4999).kind).toBe('none')
    expect(s.update('unknown', 5000)).toEqual({ kind: 'resolve', resolution: 'measurement_unavailable' })
  })
})

// -- 3. AI health as AI_STATUS -------------------------------------------------------------------------

function view(overrides: Partial<AIPipelineView['health']> = {}, runtime: 'present' | null = 'present'): AIPipelineView {
  return {
    health: {
      state: 'RUNNING',
      reason: null,
      cameraAvailable: true,
      runtimeState: 'RUNNING',
      detectors: [
        { id: 'mediapipe.face-presence', state: 'RUNNING' },
        { id: 'mediapipe.gaze', state: 'RUNNING' },
      ],
      ...overrides,
    },
    telemetry: {
      framesCaptured: 0,
      framesProcessed: 0,
      framesDropped: 0,
      framesUnavailable: 0,
      lastLatencyMs: null,
      avgLatencyMs: null,
      processedFps: null,
      runtimeLoadMs: null,
      startedAt: null,
      runtime:
        runtime === null
          ? null
          : { id: 'mediapipe', version: '1', kind: 'mediapipe', productionCapable: true, accelerator: 'CPU', objectDetector: null, loadErrors: [] },
      lastStageTimingsMs: null,
    },
    recentObservations: [],
  }
}

describe('aiStatusOf', () => {
  it.each([
    [view(), 'RUNNING', 'none'],
    [view({ state: 'INITIALIZING' }), 'INITIALIZING', 'none'],
    [view({ state: 'DEGRADED' }, null), 'DEGRADED', 'no_runtime'],
    [view({ state: 'ERROR', runtimeState: 'LOAD_FAILED' }), 'ERROR', 'model_load_failed'],
    [view({ state: 'ERROR', runtimeState: 'ERROR' }), 'ERROR', 'runtime_error'],
    [view({ state: 'DEGRADED', cameraAvailable: false }), 'DEGRADED', 'camera_unavailable'],
    [view({ state: 'DEGRADED' }), 'DEGRADED', 'inference_slow'],
  ])('maps health to a status and reason code', (v, status, reason) => {
    expect(aiStatusOf(v)).toMatchObject({ ai_status: status, ai_reason: reason })
  })

  it('names impaired detectors by their server names', () => {
    const v = view({ state: 'DEGRADED', detectors: [{ id: 'mediapipe.gaze', state: 'ERROR' }, { id: 'object-detection', state: 'DEGRADED' }] })
    expect(aiStatusOf(v)).toEqual({ ai_status: 'DEGRADED', ai_reason: 'detector_impaired', impaired: ['gaze', 'object_detection'], accelerator: 'CPU' })
  })
})

// -- 4. the processor ------------------------------------------------------------------------------------

type Sent = { type: string; metadata: Record<string, unknown> }

function harness(timing: Partial<ConditionTiming> = TIMING, statusStableMs = 1000) {
  const sent: Sent[] = []
  let clock = 0
  let id = 0
  const processor = new AIEventProcessor({
    report: (type, metadata) => sent.push({ type, metadata }),
    config: withOverrides(DEFAULT_AI_EVENT_CONFIG, { allTiming: timing, statusStableMs, frameStaleMs: 1500 }),
    now: () => clock,
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  })
  const frames = (observations: Observation[], from: number, to: number, step = 250) => {
    for (let t = from; t <= to; t += step) {
      clock = t
      processor.observeFrame(observations, t)
    }
  }
  return {
    sent,
    processor,
    frames,
    at: (t: number) => {
      clock = t
    },
  }
}

describe('AIEventProcessor', () => {
  it('turns a sustained condition into exactly one started and one resolved event', () => {
    const h = harness()
    h.frames([face(0), quality(0.45)], 0, 10_000) // 41 frames with no face
    h.frames(normal(), 10_250, 13_000)

    const faceEvents = h.sent.filter((e) => e.type === 'FACE_NOT_DETECTED')
    expect(faceEvents).toEqual([
      { type: 'FACE_NOT_DETECTED', metadata: { phase: 'started', episode_id: '00000000-0000-4000-8000-000000000001', detector: 'face_presence' } },
      { type: 'FACE_NOT_DETECTED', metadata: { phase: 'resolved', episode_id: '00000000-0000-4000-8000-000000000001', resolution: 'condition_cleared' } },
    ])
    expect(h.processor.openEpisodes()).toEqual([])
  })

  it('reports nothing for a normal candidate', () => {
    const h = harness()
    h.frames(normal(), 0, 60_000)
    expect(h.sent).toEqual([])
  })

  it('keeps independent episodes for independent conditions', () => {
    const h = harness()
    h.frames(normal(), 0, 1500) // calibrates the neutral yaw at 2°
    h.frames([face(2), head(40, 0), gaze(0.1, 0), quality(0.45, 0.1)], 1750, 5000)
    expect(h.sent.map((e) => [e.type, e.metadata.phase])).toEqual([
      ['MULTIPLE_FACES_DETECTED', 'started'],
      ['HEAD_ORIENTATION_CHANGED', 'started'],
    ])
    expect(h.sent[1]!.metadata).toMatchObject({ direction: 'left', yaw_deg: 40, neutral_yaw_deg: 2, detector: 'head_pose' })
  })

  describe('head orientation against a calibrated −10° neutral', () => {
    const at = (yaw: number) => [face(1), head(yaw, 0), quality(0.45, 0.1)]
    const calibrated = () => {
      const h = harness()
      h.frames(at(-10), 0, 1500)
      expect(h.processor.diagnostics().headCalibration).toMatchObject({ status: 'calibrated', neutralYawDeg: -10 })
      return h
    }

    it('small movements around the neutral never produce an event', () => {
      const h = calibrated()
      let t = 1750
      for (let i = 0; i < 240; i++, t += 250) {
        h.at(t)
        h.processor.observeFrame(at(-10 + 8 * Math.sin(i / 3)), t) // ±8° for 60 s
      }
      expect(h.sent).toEqual([])
    })

    it('a sustained ~20° deviation starts an episode only after stabilisation, then resolves', () => {
      const h = calibrated()
      h.frames(at(-30), 1750, 2500) // 4 frames, 750 ms: not yet (needs ≥ 1000 ms)
      expect(h.sent).toEqual([])
      h.frames(at(-30), 2750, 3000)
      expect(h.sent).toEqual([
        {
          type: 'HEAD_ORIENTATION_CHANGED',
          metadata: expect.objectContaining({ phase: 'started', direction: 'right', yaw_deg: -30, neutral_yaw_deg: -10 }),
        },
      ])
      h.frames(at(-11), 3250, 5000)
      expect(h.sent.at(-1)).toMatchObject({ type: 'HEAD_ORIENTATION_CHANGED', metadata: { phase: 'resolved', resolution: 'condition_cleared' } })
    })

    it('the baseline does not move during an episode', () => {
      const h = calibrated()
      h.frames(at(12), 1750, 30_000) // a long, stable 22° turn to the left
      expect(h.processor.diagnostics().headCalibration).toMatchObject({ neutralYawDeg: -10 })
      expect(h.sent.filter((e) => e.metadata.phase === 'started')).toHaveLength(1)
      expect(h.processor.openEpisodes().map((e) => e.eventType)).toEqual(['HEAD_ORIENTATION_CHANGED'])
    })

    it('an absolute yaw beyond the old 25° limit is not a turn for a candidate whose neutral is there', () => {
      const h = harness()
      h.frames(at(28), 0, 30_000) // sits off-centre: neutral 28°
      expect(h.sent).toEqual([])
    })

    it('reports nothing while still calibrating', () => {
      const h = harness()
      // Too unstable to calibrate (alternating ±30°): head orientation stays unknown throughout.
      let t = 0
      for (let i = 0; i < 40; i++, t += 250) {
        h.at(t)
        h.processor.observeFrame(at(i % 2 ? 30 : -30), t)
      }
      expect(h.processor.diagnostics().headCalibration.status).toBe('calibrating')
      expect(h.sent).toEqual([])
    })
  })

  describe('GAZE_AWAY is disabled', () => {
    it('is not a produced type, and configuration cannot re-enable it', () => {
      expect(DISABLED_EVENT_TYPES.has('GAZE_AWAY')).toBe(true)
      expect(PRODUCED_EVENT_TYPES).not.toContain('GAZE_AWAY')
      expect(Object.keys(withOverrides(DEFAULT_AI_EVENT_CONFIG, {}))).not.toContain('enabled')
    })

    it('gaze observations never produce a GAZE_AWAY event, even far past the old threshold', () => {
      const h = harness()
      h.frames([face(1), head(0, 0), gaze(-0.95, 0.9), quality(0.45, 0.1)], 0, 60_000)
      h.processor.stop()
      expect(h.sent.map((e) => e.type)).not.toContain('GAZE_AWAY')
      expect(h.sent).toEqual([])
    })

    it('still closes a GAZE_AWAY episode left open by an earlier build', () => {
      const h = harness()
      h.processor.closeLeftovers([{ eventType: 'GAZE_AWAY', episodeId: '00000000-0000-4000-8000-0000000000aa' }])
      expect(h.sent).toEqual([
        { type: 'GAZE_AWAY', metadata: { phase: 'resolved', episode_id: '00000000-0000-4000-8000-0000000000aa', resolution: 'monitoring_stopped' } },
      ])
    })
  })

  it('ends an episode as measurement_unavailable when frames stop arriving', () => {
    const h = harness()
    h.frames([face(0)], 0, 2000)
    expect(h.processor.openEpisodes()).toHaveLength(1)
    for (let t = 3000; t <= 9000; t += 1000) {
      h.at(t)
      h.processor.tick()
    }
    expect(h.sent.at(-1)).toMatchObject({ type: 'FACE_NOT_DETECTED', metadata: { phase: 'resolved', resolution: 'measurement_unavailable' } })
  })

  it('closes open episodes as monitoring_stopped when monitoring stops', () => {
    const h = harness()
    h.frames([face(0)], 0, 2000)
    h.processor.stop()
    expect(h.sent.at(-1)).toMatchObject({ type: 'FACE_NOT_DETECTED', metadata: { phase: 'resolved', resolution: 'monitoring_stopped' } })
    h.frames([face(0)], 3000, 9000)
    expect(h.sent.filter((e) => e.metadata.phase === 'started')).toHaveLength(1) // nothing after stop
  })

  it('reports AI health only once a change has held, and never flapping', () => {
    const h = harness(TIMING, 1000)
    h.at(0)
    h.processor.observeHealth(view())
    h.at(500)
    h.processor.tick()
    expect(h.sent).toEqual([]) // not yet stable
    h.at(1000)
    h.processor.tick()
    expect(h.sent).toEqual([{ type: 'AI_STATUS', metadata: { ai_status: 'RUNNING', ai_reason: 'none', impaired: [], accelerator: 'CPU' } }])

    // borderline latency flapping RUNNING ↔ DEGRADED every 300 ms: nothing new is reported
    for (let t = 1100; t < 4000; t += 300) {
      h.at(t)
      h.processor.observeHealth(view({ state: (t / 100) % 2 ? 'DEGRADED' : 'RUNNING' }))
      h.processor.tick()
    }
    h.at(4200)
    h.processor.observeHealth(view())
    h.at(6000)
    h.processor.tick()
    expect(h.sent.filter((e) => e.type === 'AI_STATUS')).toHaveLength(1)

    h.processor.observeHealth(view({ state: 'ERROR', runtimeState: 'ERROR' }))
    h.at(7000)
    h.processor.tick()
    expect(h.sent.at(-1)).toMatchObject({ type: 'AI_STATUS', metadata: { ai_status: 'ERROR', ai_reason: 'runtime_error' } })
    h.processor.stop()
    expect(h.sent.at(-1)).toEqual({ type: 'AI_STATUS', metadata: { ai_status: 'STOPPED', ai_reason: 'stopped', impaired: [] } })
  })

  it('reports no STOPPED for a pipeline torn down before its status settled', () => {
    const h = harness()
    h.processor.observeHealth(view({ state: 'INITIALIZING' }))
    h.processor.stop()
    expect(h.sent).toEqual([])
  })

  it('closes episodes a previous run left open', () => {
    const h = harness()
    h.processor.closeLeftovers([
      { eventType: 'GAZE_AWAY', episodeId: '00000000-0000-4000-8000-00000000000a' },
      { eventType: 'PHONE_DETECTED' as never, episodeId: 'x' },
    ])
    expect(h.sent).toEqual([
      { type: 'GAZE_AWAY', metadata: { phase: 'resolved', episode_id: '00000000-0000-4000-8000-00000000000a', resolution: 'monitoring_stopped' } },
    ])
  })

  it('never reports a score, risk, verdict or phone field', () => {
    const h = harness()
    const phone = obs('OBJECT_DETECTION', { objectClass: 'cell phone' }, 0.99)
    h.frames([face(3), head(-50, 30), gaze(-0.9, -0.9), quality(0.01, 0.9), phone], 0, 5000)
    h.frames([face(0), quality(0.01), phone], 5250, 12_000)
    h.processor.stop()
    const text = JSON.stringify(h.sent).toLowerCase()
    for (const forbidden of ['score', 'risk', 'cheat', 'verdict', 'suspicious', 'phone', 'fraud', 'guilt']) {
      expect(text).not.toContain(forbidden)
    }
    expect(h.sent.length).toBeGreaterThan(0)
  })
})

// -- 5. end to end through the real detectors ----------------------------------------------------------------

describe('real detectors → processor', () => {
  it('drives the real Phase 5B detectors from a scripted scene into episodes', async () => {
    let scene: ScriptedScene = { faces: 1, yawDeg: -8, pitchDeg: 0 } // calibrates the neutral at −8°
    const runtime = new ScriptedMediaPipeRuntime(() => scene)
    await runtime.load()
    const detectors = createMediaPipeDetectors()
    for (const detector of detectors) await detector.init()
    const h = harness()

    const run = async (from: number, to: number) => {
      for (let t = from; t <= to; t += 250) {
        const f = frame(t, t)
        const raw = await runtime.infer(f)
        h.at(t)
        h.processor.observeFrame(detectors.flatMap((d) => d.process(f, raw)), t)
      }
    }
    await run(0, 1500)
    expect(h.processor.diagnostics().headCalibration).toMatchObject({ status: 'calibrated', neutralYawDeg: -8 })
    scene = { faces: 1, yawDeg: -35, pitchDeg: 0 }
    await run(1750, 3500)
    const started = h.sent.find((e) => e.type === 'HEAD_ORIENTATION_CHANGED')
    expect(started?.metadata).toMatchObject({ phase: 'started', direction: 'right' })
    expect(started?.metadata.yaw_deg).toBeCloseTo(-35, 1)

    scene = { faces: 1, yawDeg: -8 }
    await run(3750, 6500)
    expect(h.sent.at(-1)).toMatchObject({ type: 'HEAD_ORIENTATION_CHANGED', metadata: { phase: 'resolved', resolution: 'condition_cleared' } })

    // Eyes far to the side and a dark image: only the image is an event — gaze is disabled.
    scene = { faces: 1, yawDeg: -8, gazeHorizontal: 0.9, meanLuminance: 0.03 }
    await run(6750, 9500)
    expect(h.sent.filter((e) => e.metadata.phase === 'started').map((e) => e.type)).toEqual([
      'HEAD_ORIENTATION_CHANGED',
      'CAMERA_TOO_DARK',
    ])
  })
})
