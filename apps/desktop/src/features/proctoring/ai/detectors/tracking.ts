import type { MediaPipePayload } from '../mediapipe/protocol'
import type { Frame, Observation } from '../types'
import { MediaPipeDetector, round } from './base'
import { FaceTracker, type TrackerOptions } from './tracker'

/**
 * Face tracking (Phase 5B.3): one `FACE_TRACK` observation per face visible in the frame, carrying a
 * short-lived track id, when the track started and how many sampled frames it has been seen in.
 *
 * The tracker's state lives only in memory and is cleared by `reset()` (camera change) and
 * `shutdown()` (exam end). When the face detector did not run successfully the tracker is left
 * untouched — a frame the model did not see is not evidence that a face went away.
 */
export class FaceTrackingDetector extends MediaPipeDetector {
  readonly id = 'mediapipe.face-tracking'
  private readonly tracker: FaceTracker

  constructor(options?: TrackerOptions) {
    super()
    this.tracker = new FaceTracker(options)
  }

  protected observe(frame: Frame, payload: MediaPipePayload): Observation[] {
    if (!this.track(payload.tasks.faceDetector) || payload.faces === null) return []
    return this.tracker.update(payload.faces, frame.monotonicTs).map((track) =>
      this.observation(frame, 'FACE_TRACK', {
        suffix: track.trackId,
        confidence: track.score != null ? round(track.score) : null,
        boundingBox: track.box,
        metadata: {
          trackId: track.trackId,
          trackStartedMs: round(track.startedAt, 1),
          framesSeen: track.framesSeen,
        },
      }),
    )
  }

  override reset(): void {
    this.tracker.reset()
  }
}
