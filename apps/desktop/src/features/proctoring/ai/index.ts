/**
 * Phase 5A — AI Proctoring Foundation.
 *
 * The camera→AI perception pipeline and its model-agnostic contracts: frame acquisition from the
 * existing proctoring camera, controlled sampling with bounded backpressure, a swappable inference
 * runtime with an explicit lifecycle, a detector interface producing factual observations, and
 * technical health + performance telemetry. Phase 5B plugs real detectors into these seams; Phase
 * 5C turns observations into persisted proctoring events. See `docs/PHASE-5A-AI-FOUNDATION.md`.
 */
export { AIStatus } from './AIStatus'
export { useAIPipeline } from './useAIPipeline'
export { AIPipeline } from './pipeline'
export { selectComponents } from './seam'
export type {
  AIHealth,
  AIHealthState,
  AIPipelineView,
  AIRuntime,
  Detector,
  DetectorState,
  Frame,
  Observation,
  PipelineTelemetry,
  RawInference,
  RuntimeInfo,
  RuntimeState,
} from './types'
