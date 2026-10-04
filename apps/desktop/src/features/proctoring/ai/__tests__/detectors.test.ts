import { describe, expect, it } from 'vitest'
import { createMediaPipeDetectors } from '../detectors'
import { FacePresenceDetector } from '../detectors/face'
import { GazeDetector, gazeFromEyes } from '../detectors/gaze'
import { HeadPoseDetector, headPoseFromMatrix } from '../detectors/headPose'
import { PhoneDetector } from '../detectors/object'
import { FrameQualityDetector } from '../detectors/quality'
import { FaceTracker, iou } from '../detectors/tracker'
import { FaceTrackingDetector } from '../detectors/tracking'
import { frameStatistics } from '../mediapipe/statistics'
import { box, frame, payload, raw, REAL_MATRIX_ROLLED_20, REAL_MATRIX_UPRIGHT } from './fixtures'

const EYES_NEUTRAL = {
  eyeLookInLeft: 0.1,
  eyeLookOutLeft: 0.1,
  eyeLookUpLeft: 0.1,
  eyeLookDownLeft: 0.1,
  eyeLookInRight: 0.1,
  eyeLookOutRight: 0.1,
  eyeLookUpRight: 0.1,
  eyeLookDownRight: 0.1,
}

async function ready<T extends { init(): Promise<void> }>(detector: T): Promise<T> {
  await detector.init()
  return detector
}

describe('face presence', () => {
  it('reports no face as an observed absence when the model ran', async () => {
    const detector = await ready(new FacePresenceDetector())
    const [observation] = detector.process(frame(), raw(payload({ faces: [] })))
    expect(observation?.observationType).toBe('FACE_PRESENCE')
    expect(observation?.metadata).toEqual({ facePresent: false, faceCount: 0 })
    expect(observation?.confidence).toBeNull()
    expect(observation?.boundingBox).toBeUndefined()
    expect(detector.state).toBe('RUNNING')
  })

  it('reports one face with the model confidence and box', async () => {
    const detector = await ready(new FacePresenceDetector())
    const [observation] = detector.process(frame(), raw(payload({ faces: [{ box: box(0.4, 0.2), score: 0.91 }] })))
    expect(observation?.metadata).toEqual({ facePresent: true, faceCount: 1 })
    expect(observation?.confidence).toBe(0.91)
    expect(observation?.boundingBox).toEqual(box(0.4, 0.2))
  })

  it('counts multiple faces and takes the most confident as primary', async () => {
    const detector = await ready(new FacePresenceDetector())
    const faces = [
      { box: box(0.1, 0.1), score: 0.6 },
      { box: box(0.6, 0.1), score: 0.95 },
      { box: box(0.3, 0.5), score: 0.7 },
    ]
    const [observation] = detector.process(frame(), raw(payload({ faces })))
    expect(observation?.metadata.faceCount).toBe(3)
    expect(observation?.confidence).toBe(0.95)
    expect(observation?.boundingBox).toEqual(box(0.6, 0.1))
  })

  it('never turns a missing or failed model into "no face"', async () => {
    const unavailable = await ready(new FacePresenceDetector())
    expect(unavailable.process(frame(), raw(payload({ tasks: { faceDetector: 'UNAVAILABLE' }, faces: null })))).toEqual([])
    expect(unavailable.state).toBe('ERROR')

    const failed = await ready(new FacePresenceDetector())
    expect(failed.process(frame(), raw(payload({ tasks: { faceDetector: 'FAILED' }, faces: null })))).toEqual([])
    expect(failed.state).toBe('DEGRADED')
  })

  it('rejects output it cannot read (malformed payload) without emitting', async () => {
    const detector = await ready(new FacePresenceDetector())
    expect(detector.process(frame(), raw({ kind: 'something-else' }))).toEqual([])
    expect(detector.process(frame(), raw(null))).toEqual([])
    expect(detector.state).toBe('ERROR')
  })

  it('emits nothing after shutdown', async () => {
    const detector = await ready(new FacePresenceDetector())
    await detector.shutdown()
    expect(detector.state).toBe('STOPPED')
    expect(detector.process(frame(), raw(payload({ faces: [{ box: box(0.4, 0.2), score: 0.9 }] })))).toEqual([])
  })
})

describe('face tracking', () => {
  it('computes overlap', () => {
    expect(iou(box(0, 0, 0.5, 0.5), box(0, 0, 0.5, 0.5))).toBeCloseTo(1)
    expect(iou(box(0, 0, 0.2, 0.2), box(0.5, 0.5, 0.2, 0.2))).toBe(0)
    expect(iou(box(0, 0, 0.4, 0.4), box(0.2, 0, 0.4, 0.4))).toBeCloseTo(1 / 3)
  })

  it('creates a track, continues it across frames, and starts a new one for a new face', () => {
    const tracker = new FaceTracker({ minIoU: 0.3, maxMissedFrames: 2 })
    const [first] = tracker.update([{ box: box(0.4, 0.2), score: 0.9 }], 100)
    expect(first?.trackId).toBe('t1')
    expect(first?.framesSeen).toBe(1)

    const second = tracker.update([{ box: box(0.42, 0.21), score: 0.92 }, { box: box(0.05, 0.6), score: 0.8 }], 200)
    const continued = second.find((track) => track.trackId === 't1')
    expect(continued?.framesSeen).toBe(2)
    expect(continued?.startedAt).toBe(100)
    expect(second.find((track) => track.trackId === 't2')?.framesSeen).toBe(1)
  })

  it('ends a track after too many missed frames and never reuses its id', () => {
    const tracker = new FaceTracker({ minIoU: 0.3, maxMissedFrames: 2 })
    tracker.update([{ box: box(0.4, 0.2), score: 0.9 }], 0)
    expect(tracker.update([], 1)).toEqual([]) // missed 1 — kept
    expect(tracker.update([], 2)).toEqual([]) // missed 2 — kept
    expect(tracker.size).toBe(1)
    tracker.update([], 3) // missed 3 — ended
    expect(tracker.size).toBe(0)
    expect(tracker.update([{ box: box(0.4, 0.2), score: 0.9 }], 4)[0]?.trackId).toBe('t2')
  })

  it('reset forgets every track and restarts ids', () => {
    const tracker = new FaceTracker()
    tracker.update([{ box: box(0.4, 0.2), score: 0.9 }], 0)
    tracker.reset()
    expect(tracker.size).toBe(0)
    expect(tracker.update([{ box: box(0.4, 0.2), score: 0.9 }], 1)[0]?.trackId).toBe('t1')
  })

  it('emits one FACE_TRACK per visible face and leaves tracks untouched when the model did not run', async () => {
    const detector = await ready(new FaceTrackingDetector())
    const observations = detector.process(frame(1, 100), raw(payload({ faces: [{ box: box(0.4, 0.2), score: 0.9 }] })))
    expect(observations).toHaveLength(1)
    expect(observations[0]?.metadata).toMatchObject({ trackId: 't1', framesSeen: 1 })

    // A failed frame is not evidence the face left: no observation, no ageing.
    expect(detector.process(frame(2, 200), raw(payload({ tasks: { faceDetector: 'FAILED' }, faces: null })))).toEqual([])
    const again = detector.process(frame(3, 300), raw(payload({ faces: [{ box: box(0.41, 0.2), score: 0.9 }] })))
    expect(again[0]?.metadata).toMatchObject({ trackId: 't1', framesSeen: 2 })
  })

  it('clears tracks on reset (camera change) and on shutdown (exam end)', async () => {
    const detector = await ready(new FaceTrackingDetector())
    const face = raw(payload({ faces: [{ box: box(0.4, 0.2), score: 0.9 }] }))
    detector.process(frame(), face)
    detector.reset()
    expect(detector.process(frame(), face)[0]?.metadata).toMatchObject({ trackId: 't1', framesSeen: 1 })
    await detector.shutdown()
    expect(detector.process(frame(), face)).toEqual([])
  })
})

describe('head pose', () => {
  /** Column-major 4x4 from R = Ry(yaw)·Rx(pitch)·Rz(roll), with an optional uniform scale. */
  function matrix(yawDeg: number, pitchDeg: number, rollDeg: number, scale = 1): number[] {
    const [y, p, r] = [yawDeg, pitchDeg, rollDeg].map((deg) => (deg * Math.PI) / 180) as [number, number, number]
    const [cy, sy, cp, sp, cr, sr] = [Math.cos(y), Math.sin(y), Math.cos(p), Math.sin(p), Math.cos(r), Math.sin(r)]
    const R = [
      [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
      [cp * sr, cp * cr, -sp],
      [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
    ]
    const m = new Array<number>(16).fill(0)
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[col * 4 + row] = R[row]![col]! * scale
    m[15] = 1
    return m
  }

  it('recovers known angles (round trip), including a scaled matrix', () => {
    for (const [yaw, pitch, roll] of [
      [0, 0, 0],
      [25, 0, 0],
      [0, -15, 0],
      [0, 0, 30],
      [-35, 20, -10],
    ] as const) {
      for (const scale of [1, 2.5]) {
        const pose = headPoseFromMatrix(matrix(yaw, pitch, roll, scale))!
        expect(pose.yawDeg).toBeCloseTo(yaw, 6)
        expect(pose.pitchDeg).toBeCloseTo(pitch, 6)
        expect(pose.rollDeg).toBeCloseTo(roll, 6)
      }
    }
  })

  it('matches the real model on the test portrait (upright, and rotated 20° clockwise)', () => {
    const upright = headPoseFromMatrix(REAL_MATRIX_UPRIGHT)!
    expect(Math.abs(upright.rollDeg)).toBeLessThan(2)
    const rolled = headPoseFromMatrix(REAL_MATRIX_ROLLED_20)!
    expect(rolled.rollDeg).toBeCloseTo(-19.66, 1) // clockwise in the image → negative roll (measured)
    expect(Math.abs(rolled.yawDeg - upright.yawDeg)).toBeLessThan(3) // an in-plane turn barely moves yaw
  })

  it('rejects malformed matrices', () => {
    expect(headPoseFromMatrix([1, 0, 0])).toBeNull()
    expect(headPoseFromMatrix(new Array(16).fill(Number.NaN))).toBeNull()
    expect(headPoseFromMatrix(new Array(16).fill(0))).toBeNull()
  })

  it('emits HEAD_POSE for a measured face, nothing when there is no face, ERROR when unavailable', async () => {
    const detector = await ready(new HeadPoseDetector())
    const measured = detector.process(
      frame(),
      raw(payload({ tasks: { faceLandmarker: 'OK' }, landmarkedFaces: [{ box: box(0.4, 0.2), transform: matrix(10, 0, 0), eyes: null }] })),
    )
    expect(measured[0]?.observationType).toBe('HEAD_POSE')
    expect(measured[0]?.metadata.yawDeg).toBeCloseTo(10, 1)
    expect(measured[0]?.confidence).toBeNull()

    expect(detector.process(frame(), raw(payload({ tasks: { faceLandmarker: 'SKIPPED' } })))).toEqual([])
    expect(detector.state).toBe('RUNNING')

    expect(detector.process(frame(), raw(payload({ tasks: { faceLandmarker: 'OK' }, landmarkedFaces: [{ box: box(0.4, 0.2), transform: null, eyes: null }] })))).toEqual([])

    detector.process(frame(), raw(payload({ tasks: { faceLandmarker: 'UNAVAILABLE' } })))
    expect(detector.state).toBe('ERROR')
  })
})

describe('gaze', () => {
  it('is centred when the eye scores are balanced', () => {
    const gaze = gazeFromEyes(EYES_NEUTRAL)!
    expect(gaze.horizontal).toBeCloseTo(0)
    expect(gaze.vertical).toBeCloseTo(0)
  })

  it('reports the documented directions', () => {
    const towardOwnLeft = gazeFromEyes({ ...EYES_NEUTRAL, eyeLookOutLeft: 0.8, eyeLookInRight: 0.8 })!
    expect(towardOwnLeft.horizontal).toBeCloseTo(0.7)
    const towardOwnRight = gazeFromEyes({ ...EYES_NEUTRAL, eyeLookInLeft: 0.8, eyeLookOutRight: 0.8 })!
    expect(towardOwnRight.horizontal).toBeCloseTo(-0.7)
    const up = gazeFromEyes({ ...EYES_NEUTRAL, eyeLookUpLeft: 0.6, eyeLookUpRight: 0.6 })!
    expect(up.vertical).toBeCloseTo(0.5)
  })

  it('does not guess from incomplete or invalid scores', () => {
    expect(gazeFromEyes(null)).toBeNull()
    const { eyeLookUpRight: _omitted, ...incomplete } = EYES_NEUTRAL
    expect(gazeFromEyes(incomplete)).toBeNull()
    expect(gazeFromEyes({ ...EYES_NEUTRAL, eyeLookInLeft: Number.NaN })).toBeNull()
  })

  it('emits GAZE with the summaries and the eight underlying scores, no confidence', async () => {
    const detector = await ready(new GazeDetector())
    const [observation] = detector.process(
      frame(),
      raw(payload({ tasks: { faceLandmarker: 'OK' }, landmarkedFaces: [{ box: box(0.4, 0.2), transform: null, eyes: EYES_NEUTRAL }] })),
    )
    expect(observation?.observationType).toBe('GAZE')
    expect(Object.keys(observation!.metadata)).toHaveLength(10)
    expect(observation?.confidence).toBeNull()
  })
})

describe('object detection', () => {
  it('reports the most confident candidate of each class as raw model confidence', async () => {
    const detector = await ready(new PhoneDetector())
    const [observation] = detector.process(
      frame(),
      raw(
        payload({
          objects: [
            { category: 'cell phone', score: 0.12, box: box(0.1, 0.1) },
            { category: 'cell phone', score: 0.64, box: box(0.5, 0.5) },
          ],
        }),
      ),
    )
    expect(observation?.observationType).toBe('OBJECT_DETECTION')
    expect(observation?.confidence).toBe(0.64)
    expect(observation?.boundingBox).toEqual(box(0.5, 0.5))
    expect(observation?.metadata).toMatchObject({ objectClass: 'cell_phone', objectModel: 'efficientdet_lite0', region: 'full' })
  })

  it('makes no detected/not-detected decision; a class with no candidate reports 0', async () => {
    const detector = await ready(new PhoneDetector())
    const observations = detector.process(frame(), raw(payload({ objects: [] })))
    expect(observations).toHaveLength(4)
    for (const observation of observations) {
      expect(observation.confidence).toBe(0)
      expect(observation.boundingBox).toBeUndefined()
      expect(observation.metadata).not.toHaveProperty('detected')
      expect(observation.metadata).not.toHaveProperty('count')
    }
  })

  it('reads each class from its own label, ignores unreported classes, and emits nothing when the model did not run', async () => {
    const detector = await ready(new PhoneDetector())
    const observations = detector.process(
      frame(),
      raw(
        payload({
          objects: [
            { category: 'book', score: 0.9, box: box(0.1, 0.1) },
            { category: 'keyboard', score: 0.95, box: box(0.2, 0.2) },
          ],
        }),
      ),
    )
    expect(Object.fromEntries(observations.map((o) => [o.metadata.objectClass, o.confidence]))).toEqual({ cell_phone: 0, book: 0.9, laptop: 0, remote: 0 })
    expect(detector.process(frame(), raw(payload({ tasks: { objectDetector: 'UNAVAILABLE' }, objects: null })))).toEqual([])
    expect(detector.state).toBe('ERROR')
  })
})

describe('frame quality', () => {
  const pixels = (...rgb: [number, number, number][]) => rgb.flatMap(([r, g, b]) => [r, g, b, 255])

  it('measures luminance and contrast', () => {
    expect(frameStatistics(pixels([0, 0, 0], [0, 0, 0]))).toEqual({ meanLuminance: 0, luminanceStdDev: 0 })
    const white = frameStatistics(pixels([255, 255, 255]))!
    expect(white.meanLuminance).toBeCloseTo(1)
    const split = frameStatistics(pixels([0, 0, 0], [255, 255, 255]))!
    expect(split.meanLuminance).toBeCloseTo(0.5)
    expect(split.luminanceStdDev).toBeCloseTo(0.5)
    expect(frameStatistics([])).toBeNull()
  })

  it('emits measurements only — no dark/blocked labels — and a face-area ratio when a face was seen', async () => {
    const detector = await ready(new FrameQualityDetector())
    const [plain] = detector.process(frame(), raw(payload()))
    expect(plain?.metadata).toEqual({ meanLuminance: 0.4, luminanceStdDev: 0.2, frameWidth: 640, frameHeight: 480 })
    const [withFace] = detector.process(frame(), raw(payload({ faces: [{ box: box(0.4, 0.2, 0.2, 0.25), score: 0.9 }] })))
    expect(withFace?.metadata.faceAreaRatio).toBeCloseTo(0.05)
    expect(detector.process(frame(), raw(payload({ statistics: null })))).toEqual([])
    expect(detector.state).toBe('DEGRADED')
  })
})

describe('observation contract', () => {
  it('never carries a verdict, risk, severity or cheating field — from any production detector', async () => {
    const forbidden = /cheat|risk|verdict|severity|suspic|guilt|fraud|violation|misconduct/i
    const detectors = createMediaPipeDetectors()
    for (const detector of detectors) await detector.init()
    const rich = raw(
      payload({
        tasks: { faceLandmarker: 'OK' },
        faces: [
          { box: box(0.4, 0.2), score: 0.9 },
          { box: box(0.05, 0.6), score: 0.7 },
        ],
        landmarkedFaces: [{ box: box(0.4, 0.2), transform: REAL_MATRIX_UPRIGHT, eyes: EYES_NEUTRAL }],
        objects: [{ category: 'cell phone', score: 0.9, box: box(0.7, 0.7) }],
      }),
    )
    const observations = detectors.flatMap((detector) => detector.process(frame(), rich))
    expect(new Set(observations.map((o) => o.observationType))).toEqual(
      new Set(['FACE_PRESENCE', 'FACE_TRACK', 'HEAD_POSE', 'GAZE', 'OBJECT_DETECTION', 'FRAME_QUALITY']),
    )
    for (const observation of observations) {
      for (const key of [...Object.keys(observation), ...Object.keys(observation.metadata)]) expect(key).not.toMatch(forbidden)
      expect(JSON.stringify(observation.metadata)).not.toMatch(forbidden)
      if (observation.confidence !== null) {
        expect(observation.confidence).toBeGreaterThanOrEqual(0)
        expect(observation.confidence).toBeLessThanOrEqual(1)
      }
    }
  })
})
