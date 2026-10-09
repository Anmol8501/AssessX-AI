import type { MediaPipePayload, NormalizedBox, PosePoint } from '../mediapipe/protocol'
import type { Frame, Observation } from '../types'
import { MediaPipeDetector, round } from './base'

/**
 * Framing (2026-10-05): is the candidate in view from the head down to the chest?
 *
 * A candidate who shows only part of their face, or sits so close that only the head is in frame,
 * could hold a phone just below the camera's view. So the exam asks for the head and the upper body
 * (to the chest) to be visible. Measured per processed frame from two facts:
 *
 * * **the shoulders** (pose landmarker, indices 11/12): each counts as in view when the model sees it
 *   (`visibility` ≥ `SHOULDER_VISIBILITY`), it lies inside the frame horizontally, and it is high
 *   enough that the chest below it is in frame too (`y` ≤ `SHOULDER_MAX_Y`);
 * * **the head** (face detector): cut off when the primary face box touches a frame edge.
 *
 * One `FRAMING` observation: how many shoulders are in view (0–2) and whether the face is cut off. The
 * decision (both shoulders and an uncut face, held for several seconds) belongs to the event layer.
 * When there is no face, or the pose model did not run, nothing is emitted: unknown, never "framed".
 *
 * PROVISIONAL values, like the other camera thresholds.
 */
export const SHOULDER_VISIBILITY = 0.5
/** A shoulder this low (0 = top, 1 = bottom) leaves no chest in view. */
export const SHOULDER_MAX_Y = 0.9
/** A face box closer than this to an edge counts as cut off. */
export const EDGE_MARGIN = 0.01

export class FramingDetector extends MediaPipeDetector {
  readonly id = 'framing'

  protected observe(frame: Frame, payload: MediaPipePayload): Observation[] {
    if (!this.track(payload.tasks.poseLandmarker) || payload.shoulders === null) return []
    const faces = payload.tasks.faceDetector === 'OK' ? (payload.faces ?? []) : []
    if (faces.length === 0) return [] // no face: framing is unknown (FACE_NOT_DETECTED covers it)
    const primary = faces.reduce((best, face) => ((face.score ?? 0) > (best.score ?? 0) ? face : best))
    const shouldersVisible = payload.shoulders.filter(inView).length
    return [
      this.observation(frame, 'FRAMING', {
        metadata: {
          shouldersVisible,
          faceCutOff: cutOff(primary.box),
          lowestShoulderY: round(Math.max(...payload.shoulders.map((s) => s.y)), 3),
        },
      }),
    ]
  }
}

export function inView(point: PosePoint): boolean {
  return point.visibility >= SHOULDER_VISIBILITY && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= SHOULDER_MAX_Y
}

export function cutOff(box: NormalizedBox): boolean {
  return (
    box.x < EDGE_MARGIN ||
    box.y < EDGE_MARGIN ||
    box.x + box.width > 1 - EDGE_MARGIN ||
    box.y + box.height > 1 - EDGE_MARGIN
  )
}
