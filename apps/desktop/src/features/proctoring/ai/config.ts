import type { AIPipelineConfig } from './scheduler'

/**
 * Phase 5A pipeline configuration.
 *
 * **These numbers are infrastructure placeholders, not product decisions.** The AssessX documents
 * do not specify a frame rate, a per-detector rate, a resolution or a latency target for the
 * desktop client (Master KB §44–49, TRD §8–10 describe the eventual architecture, not values);
 * those are deferred to the Phase 5 Knowledge Base and finalised with the Phase 5B detectors, which
 * may sample different detectors at different rates. The defaults below only keep the foundation
 * running and observable at a gentle, safe rate; nothing downstream should treat them as tuned.
 */
export const DEFAULT_AI_CONFIG: AIPipelineConfig = {
  // At most ~2 samples/sec; slower when inference takes longer (ticks are chained after each frame).
  inferenceIntervalMs: 500,
  // DEGRADED when the rolling-average inference latency exceeds the sampling interval, i.e. when
  // inference cannot keep up with the configured rate. Tied to the interval rather than an invented
  // latency target. (Phase 5B measured ~290 ms per frame for all six detectors on CPU on the
  // development machine — one machine, not a validated figure.)
  latencyBudgetMs: 500,
  // Samples kept for the rolling average-latency / FPS figures.
  rollingWindow: 30,
}
