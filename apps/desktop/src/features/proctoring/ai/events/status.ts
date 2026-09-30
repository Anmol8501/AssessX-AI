import type { AIPipelineView } from '../types'
import { DETECTOR_NAMES } from './conditions'

/**
 * Phase 5C: the AI's technical health as the server's `AI_STATUS` fields. This is about whether
 * perception is working — never about the candidate — and is kept in its own event category
 * (AI_HEALTH), apart from the candidate observations.
 *
 * The reason is derived from the same structured inputs as the pipeline's health (runtime state,
 * camera, detector states, latency), not parsed from its human-readable text.
 */
export interface AIStatusReport {
  ai_status: 'INITIALIZING' | 'RUNNING' | 'DEGRADED' | 'ERROR' | 'STOPPED'
  ai_reason:
    | 'none'
    | 'no_runtime'
    | 'model_load_failed'
    | 'runtime_error'
    | 'camera_unavailable'
    | 'detector_impaired'
    | 'inference_slow'
    | 'stopped'
  impaired: string[]
  accelerator?: 'CPU' | 'GPU'
}

export function aiStatusOf(view: AIPipelineView): AIStatusReport {
  const { health, telemetry } = view
  const impaired = health.detectors
    .filter((detector) => detector.state === 'ERROR' || detector.state === 'DEGRADED')
    .map((detector) => DETECTOR_NAMES[detector.id])
    .filter((name): name is string => name !== undefined)
  const accelerator = telemetry.runtime?.accelerator ?? undefined
  const report = (ai_status: AIStatusReport['ai_status'], ai_reason: AIStatusReport['ai_reason']): AIStatusReport => ({
    ai_status,
    ai_reason,
    impaired: ai_status === 'DEGRADED' || ai_status === 'ERROR' ? impaired : [],
    ...(accelerator ? { accelerator } : {}),
  })

  switch (health.state) {
    case 'STOPPED':
      return report('STOPPED', 'stopped')
    case 'INITIALIZING':
      return report('INITIALIZING', 'none')
    case 'RUNNING':
      return report('RUNNING', 'none')
  }
  if (telemetry.runtime === null) return report(health.state, 'no_runtime')
  if (health.runtimeState === 'LOAD_FAILED') return report(health.state, 'model_load_failed')
  if (health.runtimeState === 'ERROR') return report(health.state, 'runtime_error')
  if (!health.cameraAvailable) return report(health.state, 'camera_unavailable')
  if (impaired.length > 0) return report(health.state, 'detector_impaired')
  return report(health.state, 'inference_slow')
}

/** Two reports describe the same health (only a change is ever reported). */
export function sameStatus(a: AIStatusReport | null, b: AIStatusReport | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
