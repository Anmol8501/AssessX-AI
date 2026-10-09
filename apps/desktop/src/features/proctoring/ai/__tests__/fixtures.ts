import type { MediaPipePayload, TaskName, TaskStatus } from '../mediapipe/protocol'
import type { Frame, RawInference } from '../types'

/** A frame with metadata only (detectors never read pixels). `closed` records release. */
export function frame(frameId = 1, monotonicTs = 1000): Frame & { closed: boolean } {
  const result = {
    frameId,
    monotonicTs,
    wallClock: '2026-09-26T10:00:00.000Z',
    width: 640,
    height: 480,
    bitmap: null,
    closed: false,
    close() {
      result.closed = true
    },
  }
  return result
}

/** A MediaPipe payload where every task ran and saw nothing, with overrides. */
export function payload(
  overrides: Omit<Partial<MediaPipePayload>, 'tasks'> & { tasks?: Partial<Record<TaskName, TaskStatus>> } = {},
): MediaPipePayload {
  const { tasks, ...rest } = overrides
  return {
    kind: 'mediapipe',
    tasks: { faceDetector: 'OK', faceLandmarker: 'SKIPPED', objectDetector: 'OK', poseLandmarker: 'SKIPPED', ...tasks },
    faces: [],
    landmarkedFaces: null,
    objects: [],
    shoulders: null,
    statistics: { meanLuminance: 0.4, luminanceStdDev: 0.2 },
    timingsMs: { statistics: 1, faceDetector: 1, faceLandmarker: 0, objectDetector: 1, poseLandmarker: 0, total: 3 },
    ...rest,
    objectModel: rest.objectModel ?? 'efficientdet_lite0',
  }
}

export function raw(value: unknown, frameId = 1, monotonicTs = 1000): RawInference {
  return { frameId, monotonicTs, payload: value }
}

export const box = (x: number, y: number, width = 0.2, height = 0.25) => ({ x, y, width, height })

/**
 * Real facial transformation matrices returned by MediaPipe 1.0.1's face landmarker (CPU) for the
 * MediaPipe test portrait, captured on 2026-09-26 — upright, and rotated 20° clockwise in the frame.
 * Column-major, as the web task returns them; values rounded to 9 decimals (they are float32).
 */
export const REAL_MATRIX_UPRIGHT = [
  0.999596655, 0.007200875, -0.027486792, 0, -0.005167108, 0.997292697,
  0.073356815, 0, 0.027940594, -0.073185079, 0.996927381, 0, -0.415395796,
  22.528911591, -71.057128906, 1,
]
export const REAL_MATRIX_ROLLED_20 = [
  0.941941619, -0.334987044, -0.023040177, 0, 0.335697085, 0.937984407,
  0.086563297, 0, -0.007386258, -0.089272119, 0.995980442, 0, 7.295370102,
  21.225172043, -70.728057861, 1,
]
