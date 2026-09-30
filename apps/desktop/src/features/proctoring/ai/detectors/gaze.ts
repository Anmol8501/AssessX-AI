import { EYE_BLENDSHAPES, type EyeBlendshape, type MediaPipePayload } from '../mediapipe/protocol'
import type { Frame, Observation } from '../types'
import { MediaPipeDetector, round } from './base'

export interface GazeEstimate {
  /** −1..1; positive = eyes turned toward the candidate's own left (see below). */
  horizontal: number
  /** −1..1; positive = eyes turned upward. */
  vertical: number
  scores: Record<EyeBlendshape, number>
}

/**
 * Gaze-related features from the landmarker's eye-direction blendshapes (0..1 each).
 *
 * The blendshapes follow the ARKit naming MediaPipe uses, where "Left"/"Right" are the subject's own
 * eyes and "Out" is away from the nose. Looking toward one's own left turns the left eye out and the
 * right eye in, so:
 *
 *     horizontal = ((outLeft + inRight) − (inLeft + outRight)) / 2
 *     vertical   = ((upLeft + upRight) − (downLeft + downRight)) / 2
 *
 * These are linear summaries of the model's own scores, not a calibrated gaze angle, and their
 * direction convention has not been validated against ground-truth gaze. No "looking away"
 * threshold is applied — that interpretation belongs to later phases.
 */
export function gazeFromEyes(eyes: Partial<Record<EyeBlendshape, number>> | null): GazeEstimate | null {
  if (!eyes) return null
  const scores = {} as Record<EyeBlendshape, number>
  for (const name of EYE_BLENDSHAPES) {
    const value = eyes[name]
    if (value === undefined || !Number.isFinite(value)) return null // incomplete: do not guess
    scores[name] = value
  }
  return {
    horizontal: (scores.eyeLookOutLeft + scores.eyeLookInRight - (scores.eyeLookInLeft + scores.eyeLookOutRight)) / 2,
    vertical: (scores.eyeLookUpLeft + scores.eyeLookUpRight - (scores.eyeLookDownLeft + scores.eyeLookDownRight)) / 2,
    scores,
  }
}

/**
 * Gaze (Phase 5B.6): one `GAZE` observation per landmarked face with complete eye blendshapes —
 * the horizontal/vertical summaries and the eight underlying scores. `confidence` is null: the
 * blendshape scores are coefficients, not detection confidence.
 */
export class GazeDetector extends MediaPipeDetector {
  readonly id = 'mediapipe.gaze'

  protected observe(frame: Frame, payload: MediaPipePayload): Observation[] {
    if (!this.track(payload.tasks.faceLandmarker) || payload.landmarkedFaces === null) return []
    const observations: Observation[] = []
    payload.landmarkedFaces.forEach((face, index) => {
      const gaze = gazeFromEyes(face.eyes)
      if (!gaze) return
      const metadata: Observation['metadata'] = {
        gazeHorizontal: round(gaze.horizontal),
        gazeVertical: round(gaze.vertical),
      }
      for (const name of EYE_BLENDSHAPES) metadata[name] = round(gaze.scores[name])
      observations.push(this.observation(frame, 'GAZE', { suffix: String(index), boundingBox: face.box, metadata }))
    })
    return observations
  }
}
