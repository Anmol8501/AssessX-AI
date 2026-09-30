/**
 * Phase 5C — AI event integration: per-frame observations → stable, factual proctoring events.
 * See `docs/PHASE-5C-AI-EVENT-INTEGRATION.md`.
 */
export { AI_EVENT_TYPES, DEFAULT_AI_EVENT_CONFIG, DISABLED_EVENT_TYPES, PRODUCED_EVENT_TYPES, withOverrides } from './config'
export type {
  AIEventConfig,
  AIEventConfigOverrides,
  AIEventThresholds,
  AIEventType,
  ConditionTiming,
  HeadCalibrationConfig,
} from './config'
export { calibrationYaw, readConditions, DETECTOR_NAMES } from './conditions'
export { HeadCalibrator } from './headCalibration'
export type { HeadCalibrationState } from './headCalibration'
export { ConditionStabilizer } from './stabilizer'
export { aiStatusOf } from './status'
export { AIEventProcessor } from './processor'
export type { AIEventDiagnostics, OpenEpisode, Report } from './processor'
