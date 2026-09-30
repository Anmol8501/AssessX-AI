import type { DetectedObject, MediaPipePayload } from '../mediapipe/protocol'
import type { Frame, Observation } from '../types'
import { MediaPipeDetector, round } from './base'

/** Reported object classes: the model's label → AssessX's stable class name. Cell phone only (product-owner decision). */
const CLASSES: Record<string, string> = { 'cell phone': 'cell_phone' }

/**
 * Phone detection (Phase 5B.4): the object model's most confident `cell phone` candidate. The model
 * is EfficientDet-Lite0 (MediaPipe, default) or, opt-in for validation, YOLOX-Tiny (ONNX Runtime) —
 * see objectDetection/models.ts. Each observation records `objectModel`, because the two models'
 * scores are not comparable.
 *
 * One `OBJECT_DETECTION` observation per class per processed frame, carrying the model's **most
 * confident candidate**: its score as `confidence` and its box. There is intentionally **no
 * detected / not-detected field**:
 *
 *   The model's metadata defines no score cut-off, so it scores every region of every frame. Measured
 *   on a portrait with no phone in it, it returned ~1,800 "cell phone" candidates at 0.01–0.04. Turning
 *   a score into "a phone is present" therefore needs a threshold, and none is documented —
 *   UNRESOLVED, to be set from a benchmark (TRD §40), not guessed here. Until then this detector only
 *   states how confident the model is that the most phone-like region is a phone.
 *
 * `confidence` is model confidence in that one region. It is not a probability that the candidate
 * has or uses a phone, and never evidence of misconduct. When the model did not run (unavailable or
 * failed) nothing is emitted.
 *
 * Note: the documents name YOLO for object detection; EfficientDet-Lite0 is a recorded deviation
 * chosen by the product owner because Ultralytics YOLO is AGPL-3.0.
 */
export class PhoneDetector extends MediaPipeDetector {
  readonly id = 'object-detection'

  protected observe(frame: Frame, payload: MediaPipePayload): Observation[] {
    if (!this.track(payload.tasks.objectDetector) || payload.objects === null) return []
    return Object.entries(CLASSES).map(([label, objectClass]) => {
      const best = payload
        .objects!.filter((object) => object.category === label)
        .reduce<DetectedObject | null>(
          (top, object) => (top === null || (object.score ?? 0) > (top.score ?? 0) ? object : top),
          null,
        )
      return this.observation(frame, 'OBJECT_DETECTION', {
        suffix: objectClass,
        confidence: best?.score != null ? round(best.score) : null,
        boundingBox: best?.box,
        metadata: { objectClass, objectModel: payload.objectModel },
      })
    })
  }
}
