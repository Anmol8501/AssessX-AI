import type { Observation } from '../types'
import type { AIEventThresholds, AIEventType } from './config'

/**
 * Phase 5C, step 1: normalise one processed frame's detector observations into a factual reading of
 * each condition — `present`, `absent` or `unknown`.
 *
 * **Unknown is never absent.** A condition is `unknown` whenever the detector that measures it
 * produced nothing usable for this frame (its model failed, was skipped, or there is no face to
 * measure). An unknown reading never starts an episode and never counts as the condition clearing;
 * it only lets a long-unmeasurable episode end as `measurement_unavailable`.
 *
 * Only the observations Phase 5B actually produces are used. Phone / object-detection output is
 * ignored on purpose (no validated threshold exists), and conditions the 5B measurements cannot
 * support — a blocked camera, a partially visible face, generic "poor quality" — are not produced.
 */

export type ConditionState = 'present' | 'absent' | 'unknown'

export type EventMetadata = Record<string, string | number | boolean>

export interface ConditionReading {
  state: ConditionState
  /** Factual measurements for the event when the condition is present (snake_case, server field names). */
  metadata: EventMetadata
}

/** The server's detector names, by Phase 5B detector id. */
export const DETECTOR_NAMES: Record<string, string> = {
  'mediapipe.face-presence': 'face_presence',
  'mediapipe.face-tracking': 'face_tracking',
  'mediapipe.head-pose': 'head_pose',
  'mediapipe.gaze': 'gaze',
  'object-detection': 'object_detection',
  'frame-quality': 'frame_quality',
}

const UNKNOWN: ConditionReading = { state: 'unknown', metadata: {} }

function reading(present: boolean, metadata: EventMetadata = {}): ConditionReading {
  return { state: present ? 'present' : 'absent', metadata: present ? metadata : {} }
}

function num(observation: Observation | undefined, key: string): number | null {
  const value = observation?.metadata[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The first observation of a type — the primary face for per-face detectors (index 0). */
function first(observations: Observation[], type: string): Observation | undefined {
  return observations.find((observation) => observation.observationType === type)
}

/**
 * The primary face's yaw when the frame is usable for head calibration: exactly one face and a
 * head-pose measurement. Null otherwise (no face, several faces, or no pose) — never a guess.
 */
export function calibrationYaw(observations: Observation[]): number | null {
  if (num(first(observations, 'FACE_PRESENCE'), 'faceCount') !== 1) return null
  return num(first(observations, 'HEAD_POSE'), 'yawDeg')
}

/**
 * `headNeutralYawDeg` is the candidate's calibrated neutral yaw (see `headCalibration.ts`); while it
 * is null (still calibrating), head orientation is `unknown`.
 */
export function readConditions(
  observations: Observation[],
  thresholds: AIEventThresholds,
  headNeutralYawDeg: number | null = null,
): Record<AIEventType, ConditionReading> {
  const presence = first(observations, 'FACE_PRESENCE')
  const faceCount = num(presence, 'faceCount')
  const head = first(observations, 'HEAD_POSE')
  const gaze = first(observations, 'GAZE')
  const quality = first(observations, 'FRAME_QUALITY')

  // Face presence and count. No FACE_PRESENCE observation = the face detector did not run: unknown.
  const noFace = faceCount === null ? UNKNOWN : reading(faceCount === 0, { detector: 'face_presence' })
  const multiple =
    faceCount === null
      ? UNKNOWN
      : reading(faceCount >= 2, {
          detector: 'face_presence',
          face_count: faceCount,
          ...(presence?.confidence != null ? { confidence: presence.confidence } : {}),
        })

  // Head and gaze need a face to measure; with none they are unknown, not "forward".
  const faceSeen = faceCount !== null && faceCount > 0
  const yaw = num(head, 'yawDeg')
  const pitch = num(head, 'pitchDeg')
  let headReading = UNKNOWN
  if (faceSeen && yaw !== null && headNeutralYawDeg !== null) {
    // Yaw relative to the candidate's own neutral; +deviation = toward the candidate's own left.
    // Pitch never makes the condition present (looking down at a desk is not an event); it is kept
    // in the metadata only as a factual measurement.
    const deviation = yaw - headNeutralYawDeg
    const turned = Math.abs(deviation) > thresholds.headYawDeviationDeg
    headReading = reading(turned, {
      detector: 'head_pose',
      direction: deviation > 0 ? 'left' : 'right',
      yaw_deg: yaw,
      neutral_yaw_deg: headNeutralYawDeg,
      ...(pitch !== null ? { pitch_deg: pitch } : {}),
    })
  }

  const horizontal = num(gaze, 'gazeHorizontal')
  const vertical = num(gaze, 'gazeVertical')
  // Diagnostic only: GAZE_AWAY is never produced (see DISABLED_EVENT_TYPES in config.ts).
  let gazeReading = UNKNOWN
  if (faceSeen && horizontal !== null && vertical !== null) {
    const direction = dominant(horizontal / thresholds.gazeHorizontal, vertical / thresholds.gazeVertical, {
      // +horizontal = eyes toward the candidate's own left; +vertical = eyes up (Phase 5B convention).
      positiveX: 'left',
      negativeX: 'right',
      positiveY: 'up',
      negativeY: 'down',
    })
    gazeReading = reading(direction !== null, {
      detector: 'gaze',
      ...(direction ? { direction } : {}),
      gaze_horizontal: horizontal,
      gaze_vertical: vertical,
    })
  }

  const luminance = num(quality, 'meanLuminance')
  const dark = luminance === null ? UNKNOWN : reading(luminance < thresholds.darkLuminance, { detector: 'frame_quality', mean_luminance: luminance })

  // Face size needs a measured face: frame quality reports the largest face's area only when one was seen.
  const area = num(quality, 'faceAreaRatio')
  const sized = quality !== undefined && faceSeen && area !== null
  const tooFar = sized ? reading(area < thresholds.faceTooFarAreaRatio, { detector: 'frame_quality', face_area_ratio: area }) : UNKNOWN
  const tooClose = sized ? reading(area > thresholds.faceTooCloseAreaRatio, { detector: 'frame_quality', face_area_ratio: area }) : UNKNOWN

  return {
    FACE_NOT_DETECTED: noFace,
    MULTIPLE_FACES_DETECTED: multiple,
    HEAD_ORIENTATION_CHANGED: headReading,
    GAZE_AWAY: gazeReading,
    CAMERA_TOO_DARK: dark,
    FACE_TOO_FAR: tooFar,
    FACE_TOO_CLOSE: tooClose,
  }
}

/** Every condition unknown — used when no frame has been processed recently. */
export function unknownConditions(): Record<AIEventType, ConditionReading> {
  return {
    FACE_NOT_DETECTED: UNKNOWN,
    MULTIPLE_FACES_DETECTED: UNKNOWN,
    HEAD_ORIENTATION_CHANGED: UNKNOWN,
    GAZE_AWAY: UNKNOWN,
    CAMERA_TOO_DARK: UNKNOWN,
    FACE_TOO_FAR: UNKNOWN,
    FACE_TOO_CLOSE: UNKNOWN,
  }
}

/**
 * Which way a 2-axis measurement points once scaled by its thresholds (|x| or |y| > 1 is beyond the
 * limit), or null when neither axis is beyond it. The axis furthest past its limit names the direction.
 */
function dominant(
  x: number,
  y: number,
  names: { positiveX: string; negativeX: string; positiveY: string; negativeY: string },
): string | null {
  if (Math.abs(x) <= 1 && Math.abs(y) <= 1) return null
  if (Math.abs(x) >= Math.abs(y)) return x > 0 ? names.positiveX : names.negativeX
  return y > 0 ? names.positiveY : names.negativeY
}
