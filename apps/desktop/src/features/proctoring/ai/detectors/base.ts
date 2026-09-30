import { isMediaPipePayload, type MediaPipePayload, type TaskStatus } from '../mediapipe/protocol'
import type { BoundingBox, Detector, DetectorState, Frame, Observation, RawInference } from '../types'

/**
 * Shared plumbing for the Phase 5B detectors.
 *
 * Every detector is a pure normaliser of the runtime's per-frame result: it never touches the
 * camera, pixels or model itself. The one rule they all follow is **"unavailable" is not "absent"**:
 * a detector whose task did not run successfully reports a technical state and emits nothing — it
 * never turns a failed or missing model into "no face" or "no phone".
 */
export abstract class MediaPipeDetector implements Detector {
  abstract readonly id: string
  readonly version = '1.0.0'
  protected _state: DetectorState = 'INITIALIZING'

  get state(): DetectorState {
    return this._state
  }

  async init(): Promise<void> {
    this._state = 'RUNNING'
  }

  process(frame: Frame, raw: RawInference): Observation[] {
    if (this._state === 'STOPPED') return []
    if (!isMediaPipePayload(raw.payload)) {
      this._state = 'ERROR' // paired with a runtime whose output this detector cannot read
      return []
    }
    return this.observe(frame, raw.payload)
  }

  reset(): void {}

  async shutdown(): Promise<void> {
    this.reset()
    this._state = 'STOPPED'
  }

  protected abstract observe(frame: Frame, payload: MediaPipePayload): Observation[]

  /** Updates this detector's technical state from its task's outcome; true only when data is usable. */
  protected track(status: TaskStatus): boolean {
    this._state = STATE_FOR[status]
    return status === 'OK'
  }

  protected observation(
    frame: Frame,
    observationType: string,
    fields: { confidence?: number | null; boundingBox?: BoundingBox; metadata: Observation['metadata']; suffix?: string },
  ): Observation {
    return {
      observationId: `${this.id}:${frame.frameId}${fields.suffix ? `:${fields.suffix}` : ''}`,
      detectorId: this.id,
      detectorVersion: this.version,
      observationType,
      monotonicTs: frame.monotonicTs,
      wallClock: frame.wallClock,
      confidence: fields.confidence ?? null,
      ...(fields.boundingBox ? { boundingBox: fields.boundingBox } : {}),
      metadata: fields.metadata,
    }
  }
}

/** A task that was skipped (nothing to measure) is healthy; a per-frame failure degrades; a missing model is an error. */
const STATE_FOR: Record<TaskStatus, DetectorState> = {
  OK: 'RUNNING',
  SKIPPED: 'RUNNING',
  FAILED: 'DEGRADED',
  UNAVAILABLE: 'ERROR',
}

/** Rounds for readability in observations; the models' precision is far below this anyway. */
export const round = (value: number, digits = 4) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
