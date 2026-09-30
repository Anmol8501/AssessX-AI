import type { MediaPipePayload } from '../mediapipe/protocol'
import type { Frame, Observation } from '../types'
import { MediaPipeDetector, round } from './base'

export interface HeadPose {
  yawDeg: number
  pitchDeg: number
  rollDeg: number
}

const DEG = 180 / Math.PI

/**
 * Head orientation from MediaPipe's 4×4 facial transformation matrix.
 *
 * The matrix is column-major (MediaPipe's `MatrixData` default, copied verbatim by the web task), so
 * element (row r, column c) is `m[c * 4 + r]`. The rotation is decomposed as R = Ry(yaw) · Rx(pitch) ·
 * Rz(roll) — yaw about the vertical axis, pitch about the horizontal axis, roll about the camera
 * axis — which gives:
 *
 *     yaw   = atan2(R02, R22)      pitch = asin(-R12)      roll = atan2(R10, R11)
 *
 * The angles are measurements in MediaPipe's camera coordinate frame, in degrees. They say nothing
 * about where the candidate "should" be looking; no threshold is applied here.
 */
export function headPoseFromMatrix(m: readonly number[]): HeadPose | null {
  if (m.length !== 16 || m.some((value) => !Number.isFinite(value))) return null
  const at = (row: number, column: number) => m[column * 4 + row]!
  const r02 = at(0, 2)
  const r22 = at(2, 2)
  const r12 = at(1, 2)
  const r10 = at(1, 0)
  const r11 = at(1, 1)
  // The matrix also carries scale; atan2 is scale-invariant, asin needs the normalised element.
  const columnScale = Math.hypot(at(0, 2), at(1, 2), at(2, 2))
  if (columnScale === 0) return null
  const pitch = Math.asin(Math.max(-1, Math.min(1, -r12 / columnScale)))
  return { yawDeg: Math.atan2(r02, r22) * DEG, pitchDeg: pitch * DEG, rollDeg: Math.atan2(r10, r11) * DEG }
}

/**
 * Head pose (Phase 5B.5): one `HEAD_POSE` observation per landmarked face — yaw, pitch and roll in
 * degrees. MediaPipe gives no confidence for the pose itself, so `confidence` is null rather than
 * a borrowed number. When there is no face to measure, nothing is emitted (face presence reports
 * the absence); when the landmarker is unavailable or failed, the detector reports that state.
 */
export class HeadPoseDetector extends MediaPipeDetector {
  readonly id = 'mediapipe.head-pose'

  protected observe(frame: Frame, payload: MediaPipePayload): Observation[] {
    if (!this.track(payload.tasks.faceLandmarker) || payload.landmarkedFaces === null) return []
    const observations: Observation[] = []
    payload.landmarkedFaces.forEach((face, index) => {
      const pose = face.transform ? headPoseFromMatrix(face.transform) : null
      if (!pose) return
      observations.push(
        this.observation(frame, 'HEAD_POSE', {
          suffix: String(index),
          boundingBox: face.box,
          metadata: { yawDeg: round(pose.yawDeg, 2), pitchDeg: round(pose.pitchDeg, 2), rollDeg: round(pose.rollDeg, 2) },
        }),
      )
    })
    return observations
  }
}
