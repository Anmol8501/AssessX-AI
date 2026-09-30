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
 * There is deliberately **no phone / object entry**: Phase 5B found no defensible phone threshold,
 * so object-detection output is never turned into an event.
 */

/** The AI observation event types Phase 5C produces (the server's `AI_EPISODE_TYPES`). */
export const AI_EVENT_TYPES = [
  'FACE_NOT_DETECTED',
  'MULTIPLE_FACES_DETECTED',
  'HEAD_ORIENTATION_CHANGED',
  'GAZE_AWAY',
  'CAMERA_TOO_DARK',
  'FACE_TOO_FAR',
  'FACE_TOO_CLOSE',
] as const
export type AIEventType = (typeof AI_EVENT_TYPES)[number]

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
    thresholds: { ...base.thresholds, ...overrides.thresholds },
    headCalibration: { ...base.headCalibration, ...overrides.headCalibration },
    frameStaleMs: overrides.frameStaleMs ?? base.frameStaleMs,
    statusStableMs: overrides.statusStableMs ?? base.statusStableMs,
    tickMs: overrides.tickMs ?? base.tickMs,
  }
}

export type AIEventConfigOverrides = Parameters<typeof withOverrides>[1]
