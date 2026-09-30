import type { MediaPipePayload } from '../mediapipe/protocol'
import type { Frame, Observation } from '../types'
import { MediaPipeDetector, round } from './base'

/**
 * Face presence and face count (Phase 5B.1 / 5B.2), from the MediaPipe BlazeFace short-range face
 * detector.
 *
 * One `FACE_PRESENCE` observation per processed frame: whether any face is visible, how many, and
 * the box and detector score of the most confident one. `faceCount` is what the model detected —
 * it is not a statement about who is present or why, and it does not identify anyone (no
 * recognition, no embeddings). A face below the detector's own default minimum confidence is not
 * reported; that minimum is MediaPipe's default, not an AssessX threshold.
 */
export class FacePresenceDetector extends MediaPipeDetector {
  readonly id = 'mediapipe.face-presence'

  protected observe(frame: Frame, payload: MediaPipePayload): Observation[] {
    if (!this.track(payload.tasks.faceDetector) || payload.faces === null) return []
    const faces = payload.faces
    const primary = faces.reduce<(typeof faces)[number] | null>(
      (best, face) => (best === null || (face.score ?? 0) > (best.score ?? 0) ? face : best),
      null,
    )
    return [
      this.observation(frame, 'FACE_PRESENCE', {
        confidence: primary?.score != null ? round(primary.score) : null,
        boundingBox: primary?.box,
        metadata: { facePresent: faces.length > 0, faceCount: faces.length },
      }),
    ]
  }
}
