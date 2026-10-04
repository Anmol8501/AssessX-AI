/**
 * Phase 5C: configuration for turning per-frame observations into stable proctoring events.
 *
 * **Every number here is provisional and configurable, not a validated product decision.** The
 * AssessX documents (PRD, TRD, Master KB) require temporal smoothing and a started → ongoing →
 * resolved lifecycle for AI observations, but they do not specify durations, frame counts or the
 * angle / score / luminance limits that make a measurement an event. The values below were chosen
 * only to keep single-frame noise out of the record, informed by the Phase 5B measurements and one
 * guided real-webcam session (2026-09-30: ~1.2 processed frames/s; deliberate head turns ≈ 20–30°
 * from a neutral that sat between −3° and −12°; eyes-only gaze did not move the gaze summaries
 * reliably; a candidate moving far back still filled ≥ 0.049 of the frame). They must be validated on
 * representative data before anyone relies on them, and they carry no judgement about the candidate.
 *
 * **Objects (2026-10-02).** At the product owner's request, object detection now produces events —
 * `PHONE_DETECTED`, `BOOK_DETECTED`, `LAPTOP_DETECTED` and `HANDHELD_DEVICE_DETECTED` — with the
 * PROVISIONAL per-model, per-class thresholds in `OBJECT_THRESHOLDS` and confirmation over several
 * frames. They are to be tuned with the guided calibration session (docs/PHASE-5D-OBJECT-DETECTION.md).
 */

import type { ObjectClassId, RunningObjectModel } from '../objectDetection/models'

/** The AI observation event types Phase 5C produces (the server's `AI_EPISODE_TYPES`). */
export const AI_EVENT_TYPES = [
  'FACE_NOT_DETECTED',
  'MULTIPLE_FACES_DETECTED',
  'HEAD_ORIENTATION_CHANGED',
  'GAZE_AWAY',
  'CAMERA_TOO_DARK',
  'FACE_TOO_FAR',
  'FACE_TOO_CLOSE',
  'PHONE_DETECTED',
  'BOOK_DETECTED',
  'LAPTOP_DETECTED',
  'HANDHELD_DEVICE_DETECTED',
] as const
export type AIEventType = (typeof AI_EVENT_TYPES)[number]

export type ObjectEventType = 'PHONE_DETECTED' | 'BOOK_DETECTED' | 'LAPTOP_DETECTED' | 'HANDHELD_DEVICE_DETECTED'

/** Which event each reported object class produces. */
export const OBJECT_EVENT: Record<ObjectClassId, ObjectEventType> = {
  cell_phone: 'PHONE_DETECTED',
  book: 'BOOK_DETECTED',
  laptop: 'LAPTOP_DETECTED',
  remote: 'HANDHELD_DEVICE_DETECTED',
}

/**
 * PROVISIONAL object thresholds: the model's confidence in its best candidate of a class at or above
 * which that frame counts as "seen". Per model, because scores are not comparable between models.
 *
 * Phone values come from the 2026-09 measurements (docs/PHASE-5B-OBJECT-MODEL-EVALUATION.md): on the
 * live webcam, frames without a phone reached at most ~0.37 (YOLOX-S) / ~0.36 (YOLOX-Tiny) /
 * ~0.47 (EfficientDet-Lite0), while phone steps reached 0.8–0.9. A single frame above the threshold
 * is never enough — see the object timing below. Book, laptop and remote have **no measurements
 * yet**; their values are conservative guesses to be replaced by the calibration session.
 */
export const OBJECT_THRESHOLDS: Record<RunningObjectModel, Record<ObjectClassId, number>> = {
  yolox_s: { cell_phone: 0.45, book: 0.5, laptop: 0.55, remote: 0.5 },
  yolox_tiny: { cell_phone: 0.45, book: 0.5, laptop: 0.55, remote: 0.5 },
  efficientdet_lite0: { cell_phone: 0.55, book: 0.55, laptop: 0.6, remote: 0.55 },
}

/**
 * Event types the processor must **not** produce, whatever the configuration says.
 *
 * `GAZE_AWAY` is disabled (webcam validation, 2026-09-30): the gaze summaries from the 5B
 * blendshapes were too weak and did not even follow the direction of an eyes-only look, so they are
 * not a usable event signal. The gaze detector and its observations remain, for diagnostics and
 * future validation; the type stays in the server's taxonomy so earlier rows remain valid.
 */
export const DISABLED_EVENT_TYPES: ReadonlySet<AIEventType> = new Set<AIEventType>(['GAZE_AWAY'])

/** The AI observation event types the processor actually produces. */
export const PRODUCED_EVENT_TYPES: readonly AIEventType[] = AI_EVENT_TYPES.filter((type) => !DISABLED_EVENT_TYPES.has(type))

/** How one condition is debounced into an episode (all times in ms of the frames' monotonic clock). */
export interface ConditionTiming {
  /** The condition must hold continuously this long before an episode starts. */
  startAfterMs: number
  /** …and be seen in at least this many sampled frames (one outlier frame is never an event). */
  minFrames: number
  /** An episode resolves once the condition has been continuously clear this long… */
  resolveAfterMs: number
  /** …over at least this many frames. */
  minClearFrames: number
  /** After a resolution, a new episode of this type cannot begin for this long (no flapping). */
  cooldownMs: number
  /** An open episode whose condition cannot be measured for this long resolves as `measurement_unavailable`. */
  unknownResolveMs: number
  /**
   * Objects only: while an episode is pending, frames without the object (or not measured) do not
   * restart the count — the `minFrames` sightings only have to fall within `pendingWindowMs` of the
   * first. Needed because a small object is often seen in one zoomed tile, or only in some frames.
   */
  tolerantPending?: boolean
  pendingWindowMs?: number
}

export interface AIEventThresholds {
  /**
   * Yaw further than this (degrees) from the candidate's **own calibrated neutral yaw** is a turned
   * head. PROVISIONAL. There is no absolute yaw limit: a candidate who sits off-centre has a
   * neutral that is not 0°. Pitch (looking down / up) does not produce an event.
   */
  headYawDeviationDeg: number
  /** Gaze summary limits — diagnostic only: `GAZE_AWAY` is disabled (see `DISABLED_EVENT_TYPES`). */
  gazeHorizontal: number
  gazeVertical: number
  /** Mean frame luminance (0..1) below this is a dark camera image. Provisional. */
  darkLuminance: number
  /** Largest face box area (fraction of the frame) below this is a face far from the camera. Provisional. */
  faceTooFarAreaRatio: number
  /** …above this is a face very close to the camera. Provisional. */
  faceTooCloseAreaRatio: number
  /** Object confidence thresholds, per running model and class. Provisional (see `OBJECT_THRESHOLDS`). */
  objects: Record<RunningObjectModel, Record<ObjectClassId, number>>
  /**
   * Added to the threshold when the best candidate was found only in a zoomed tile. Enlarged crops
   * make look-alikes score higher: on the COCO set (benchmarks/objects/results/tiling.md) +0.05 cut
   * YOLOX-S's phone false positives from 10% to 8% of phone-free images while keeping most of the
   * gain on tiny phones (55% → 53%; 35% without tiles). Provisional.
   */
  objectTileMargin: number
}

/**
 * How a candidate's neutral head yaw is calibrated at the start of monitoring. PROVISIONAL.
 *
 * The neutral is the median of the first run of `samples` consecutive usable frames (exactly one
 * face and a head-pose measurement) whose yaw values lie within `maxSpreadDeg` of each other and
 * within ±`maxAbsYawDeg`. A frame without a usable measurement breaks the run. Once set, the neutral
 * is fixed for the rest of this monitoring run — it never drifts, including during an episode.
 */
export interface HeadCalibrationConfig {
  samples: number
  maxSpreadDeg: number
  maxAbsYawDeg: number
}

export interface AIEventConfig {
  timing: Record<AIEventType, ConditionTiming>
  thresholds: AIEventThresholds
  headCalibration: HeadCalibrationConfig
  /** No processed frame for this long means nothing can be measured (camera lost, AI stopped). */
  frameStaleMs: number
  /** A change of AI health is reported only once it has held this long (no status flapping). */
  statusStableMs: number
  /** How often the processor re-evaluates time-based transitions when frames stop arriving. */
  tickMs: number
}

const standard = (startAfterMs: number, minFrames: number): ConditionTiming => ({
  startAfterMs,
  minFrames,
  resolveAfterMs: 2000,
  minClearFrames: 3,
  cooldownMs: 3000,
  unknownResolveMs: 5000,
})

/**
 * Objects: two sightings within 6 s start an episode (one stray frame never does); it ends after 5 s
 * and 5 measured frames without a sighting. PROVISIONAL, like everything here.
 */
const objectTiming: ConditionTiming = {
  startAfterMs: 0,
  minFrames: 2,
  tolerantPending: true,
  pendingWindowMs: 6000,
  resolveAfterMs: 5000,
  minClearFrames: 5,
  cooldownMs: 5000,
  unknownResolveMs: 15000,
}

export const DEFAULT_AI_EVENT_CONFIG: AIEventConfig = {
  timing: {
    // 3 frames (was 5): the real sample rate measured on a webcam is ~1.2 frames/s, so 5 frames
    // made the frame count, not `startAfterMs`, decide the response time.
    FACE_NOT_DETECTED: standard(3000, 3),
    MULTIPLE_FACES_DETECTED: standard(2000, 4),
    HEAD_ORIENTATION_CHANGED: standard(3000, 5),
    GAZE_AWAY: standard(4000, 6),
    CAMERA_TOO_DARK: standard(5000, 6),
    FACE_TOO_FAR: standard(5000, 6),
    FACE_TOO_CLOSE: standard(5000, 6),
    PHONE_DETECTED: objectTiming,
    BOOK_DETECTED: objectTiming,
    LAPTOP_DETECTED: objectTiming,
    HANDHELD_DEVICE_DETECTED: objectTiming,
  },
  thresholds: {
    // Deviation from the candidate's calibrated neutral (was an absolute 25° yaw / 20° pitch).
    headYawDeviationDeg: 18,
    gazeHorizontal: 0.35,
    gazeVertical: 0.35,
    darkLuminance: 0.1,
    // Was 0.015, which a candidate moving well back from a laptop camera (≥ 0.049) never reached.
    faceTooFarAreaRatio: 0.03,
    faceTooCloseAreaRatio: 0.35,
    objects: OBJECT_THRESHOLDS,
    objectTileMargin: 0.05,
  },
  headCalibration: {
    samples: 5,
    maxSpreadDeg: 8,
    maxAbsYawDeg: 40,
  },
  frameStaleMs: 3000,
  statusStableMs: 3000,
  tickMs: 1000,
}

/** Applies a partial override (the E2E seam uses this for fast timings). */
export function withOverrides(
  base: AIEventConfig,
  overrides: {
    timing?: Partial<Record<AIEventType, Partial<ConditionTiming>>>
    allTiming?: Partial<ConditionTiming>
    thresholds?: Partial<AIEventThresholds>
    headCalibration?: Partial<HeadCalibrationConfig>
    frameStaleMs?: number
    statusStableMs?: number
    tickMs?: number
  } = {},
): AIEventConfig {
  const timing = {} as Record<AIEventType, ConditionTiming>
  for (const type of AI_EVENT_TYPES) {
    timing[type] = { ...base.timing[type], ...overrides.allTiming, ...overrides.timing?.[type] }
  }
  return {
    timing,
    thresholds: { ...base.thresholds, ...overrides.thresholds, objects: overrides.thresholds?.objects ?? base.thresholds.objects },
    headCalibration: { ...base.headCalibration, ...overrides.headCalibration },
    frameStaleMs: overrides.frameStaleMs ?? base.frameStaleMs,
    statusStableMs: overrides.statusStableMs ?? base.statusStableMs,
    tickMs: overrides.tickMs ?? base.tickMs,
  }
}

export type AIEventConfigOverrides = Parameters<typeof withOverrides>[1]
