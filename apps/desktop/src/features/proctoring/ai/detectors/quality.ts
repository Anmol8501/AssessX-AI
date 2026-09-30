import type { MediaPipePayload } from '../mediapipe/protocol'
import type { Frame, Observation } from '../types'
import { MediaPipeDetector, round } from './base'

/**
 * Camera / frame quality (Phase 5B.7): one `FRAME_QUALITY` observation per processed frame with
 * factual measurements — mean luminance and global contrast of the frame, its resolution, and (when
 * the face detector saw a face) the fraction of the frame the largest face occupies.
 *
 * It deliberately does **not** label a frame "too dark", "blocked" or "face too far": no threshold
 * for those is documented, so none is invented. Downstream phases can apply documented thresholds
 * to these numbers.
 */
export class FrameQualityDetector extends MediaPipeDetector {
  readonly id = 'frame-quality'

  protected observe(frame: Frame, payload: MediaPipePayload): Observation[] {
    const stats = payload.statistics
    if (!stats) {
      this._state = 'DEGRADED' // the frame could not be measured this time
      return []
    }
    this._state = 'RUNNING'
    const metadata: Observation['metadata'] = {
      meanLuminance: round(stats.meanLuminance),
      luminanceStdDev: round(stats.luminanceStdDev),
      frameWidth: frame.width,
      frameHeight: frame.height,
    }
    if (payload.tasks.faceDetector === 'OK' && payload.faces && payload.faces.length > 0) {
      const largest = Math.max(...payload.faces.map((face) => face.box.width * face.box.height))
      metadata.faceAreaRatio = round(largest)
    }
    return [this.observation(frame, 'FRAME_QUALITY', { metadata })]
  }
}
