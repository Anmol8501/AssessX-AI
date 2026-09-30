import type { AIHealth, AIHealthState, Detector, RuntimeState } from './types'

interface HealthInputs {
  /** Whether the pipeline has finished starting; false → INITIALIZING. */
  started: boolean
  /** Whether the pipeline has been stopped; true → STOPPED. */
  stopped: boolean
  cameraAvailable: boolean
  /** The selected runtime, or null when no production model is available in this build (Phase 5A). */
  runtimeState: RuntimeState | null
  detectors: Detector[]
  avgLatencyMs: number | null
  latencyBudgetMs: number
}

/**
 * Derives the pipeline's technical health honestly (plan 5A.6, prompt §15–§16).
 *
 * The pipeline never claims to be monitoring when it is not: no runtime, a failed model, a lost
 * camera or a failed detector all surface as DEGRADED or ERROR with a plain reason, and a technical
 * failure is never turned into a statement about the candidate. Health is technical only — it says
 * whether perception is working, not anything about who is on camera.
 */
export function deriveHealth(inputs: HealthInputs): AIHealth {
  const detectors = inputs.detectors.map((detector) => ({ id: detector.id, state: detector.state }))
  const runtimeState = inputs.runtimeState ?? 'UNINITIALIZED'
  const base = { cameraAvailable: inputs.cameraAvailable, runtimeState, detectors }

  const at = (state: AIHealthState, reason: string | null): AIHealth => ({ state, reason, ...base })

  if (inputs.stopped) return at('STOPPED', null)
  if (!inputs.started) return at('INITIALIZING', null)

  // No runtime could be provided in this environment (e.g. no Web Worker support). Reported plainly
  // rather than pretending detection is active.
  if (inputs.runtimeState === null) {
    return at('DEGRADED', 'AI detection runtime is not available in this environment.')
  }
  if (inputs.runtimeState === 'LOAD_FAILED') return at('ERROR', 'AI model failed to load.')
  if (inputs.runtimeState === 'ERROR') return at('ERROR', 'AI runtime error.')
  if (!inputs.cameraAvailable) return at('DEGRADED', 'Camera stream unavailable to AI monitoring.')

  if (detectors.length > 0 && detectors.every((detector) => detector.state === 'ERROR')) {
    return at('ERROR', 'All AI detectors have failed.')
  }
  const impaired = detectors.filter((detector) => detector.state === 'ERROR' || detector.state === 'DEGRADED')
  if (impaired.length > 0) {
    return at('DEGRADED', `Not fully functioning: ${impaired.map((detector) => label(detector.id)).join(', ')}.`)
  }
  if (inputs.avgLatencyMs !== null && inputs.avgLatencyMs > inputs.latencyBudgetMs) {
    return at('DEGRADED', 'AI inference is running slower than expected on this device.')
  }
  return at('RUNNING', null)
}

/** `mediapipe.head-pose` → `head pose`: a readable name for a technical reason. */
function label(detectorId: string): string {
  return (detectorId.split('.').pop() ?? detectorId).replace(/-/g, ' ')
}
