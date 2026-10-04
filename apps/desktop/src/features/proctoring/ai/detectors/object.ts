import { OBJECT_CLASSES } from '../objectDetection/models'
import type { DetectedObject, MediaPipePayload } from '../mediapipe/protocol'
import type { Frame, Observation } from '../types'
import { MediaPipeDetector, round } from './base'

/**
 * Object detection: for each reported class — a mobile phone, a book, a laptop or tablet, a
 * remote/calculator-like device (product-owner decision, 2026-10-02) — the object model's **most
 * confident candidate** in this frame.
 *
 * One `OBJECT_DETECTION` observation per class per processed frame, carrying that candidate's score
 * as `confidence`, its box, its size as a share of the frame, and where it was found (the whole frame
 * or a zoomed tile — see objectDetection/tiling.ts). A class with no candidate at all reports a
 * confidence of 0.
 *
 * This detector makes **no decision**. Whether an object counts as present is decided by the event
 * layer (`events/conditions.ts`), with per-model, per-class thresholds and confirmation over several
 * frames. `confidence` is the model's confidence in one region — never a probability that the
 * candidate is using the object, and never evidence of misconduct. Every observation records the model
 * that produced it (`objectModel`), because scores are not comparable between models.
 *
 * When the object model did not run on this frame (unavailable, failed, or skipped on the slower CPU
 * path), nothing is emitted: "not measured" is never "no object".
 */
export class ObjectPresenceDetector extends MediaPipeDetector {
  readonly id = 'object-detection'

  protected observe(frame: Frame, payload: MediaPipePayload): Observation[] {
    if (!this.track(payload.tasks.objectDetector) || payload.objects === null) return []
    return OBJECT_CLASSES.map(({ id, label }) => {
      const best = payload
        .objects!.filter((object) => object.category === label)
        .reduce<DetectedObject | null>((top, object) => (top === null || (object.score ?? 0) > (top.score ?? 0) ? object : top), null)
      return this.observation(frame, 'OBJECT_DETECTION', {
        suffix: id,
        confidence: round(best?.score ?? 0),
        boundingBox: best?.box,
        metadata: {
          objectClass: id,
          objectModel: payload.objectModel,
          ...(best ? { boxAreaRatio: round(best.box.width * best.box.height), region: best.region ?? 'full' } : {}),
        },
      })
    })
  }
}

/** The earlier name (phone only); kept so existing imports keep working. */
export const PhoneDetector = ObjectPresenceDetector
