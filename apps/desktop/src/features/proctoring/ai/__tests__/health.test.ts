import { describe, expect, it } from 'vitest'
import { deriveHealth } from '../health'
import type { Detector, DetectorState } from '../types'

const detector = (id: string, state: DetectorState) => ({ id, state }) as Detector
const base = {
  started: true,
  stopped: false,
  cameraAvailable: true,
  runtimeState: 'RUNNING' as const,
  detectors: [detector('mediapipe.face-presence', 'RUNNING')],
  avgLatencyMs: 100,
  latencyBudgetMs: 500,
}

describe('AI health (technical only)', () => {
  it('is RUNNING only when everything works', () => {
    expect(deriveHealth(base)).toMatchObject({ state: 'RUNNING', reason: null })
  })

  it('reports lifecycle states', () => {
    expect(deriveHealth({ ...base, started: false }).state).toBe('INITIALIZING')
    expect(deriveHealth({ ...base, stopped: true }).state).toBe('STOPPED')
  })

  it('never claims monitoring without a usable runtime', () => {
    expect(deriveHealth({ ...base, runtimeState: null })).toMatchObject({ state: 'DEGRADED' })
    expect(deriveHealth({ ...base, runtimeState: 'LOAD_FAILED' })).toMatchObject({ state: 'ERROR', reason: 'AI model failed to load.' })
    expect(deriveHealth({ ...base, runtimeState: 'ERROR' }).state).toBe('ERROR')
  })

  it('says plainly when the camera is unavailable', () => {
    expect(deriveHealth({ ...base, cameraAvailable: false }).reason).toMatch(/camera/i)
  })

  it('names the detectors that are not working', () => {
    const health = deriveHealth({
      ...base,
      detectors: [detector('mediapipe.face-presence', 'RUNNING'), detector('mediapipe.head-pose', 'ERROR'), detector('mediapipe.gaze', 'DEGRADED')],
    })
    expect(health).toMatchObject({ state: 'DEGRADED', reason: 'Not fully functioning: head pose, gaze.' })
    expect(deriveHealth({ ...base, detectors: [detector('a', 'ERROR'), detector('b', 'ERROR')] }).state).toBe('ERROR')
  })

  it('degrades when inference cannot keep up with the sampling interval', () => {
    expect(deriveHealth({ ...base, avgLatencyMs: 499 }).state).toBe('RUNNING')
    expect(deriveHealth({ ...base, avgLatencyMs: 501 }).state).toBe('DEGRADED')
  })

  it('never phrases a technical problem as something about the candidate', () => {
    const reasons = [
      deriveHealth({ ...base, runtimeState: null }),
      deriveHealth({ ...base, runtimeState: 'ERROR' }),
      deriveHealth({ ...base, cameraAvailable: false }),
      deriveHealth({ ...base, avgLatencyMs: 9_999 }),
      deriveHealth({ ...base, detectors: [detector('mediapipe.gaze', 'ERROR'), detector('x', 'RUNNING')] }),
    ].map((health) => health.reason ?? '')
    for (const reason of reasons) expect(reason).not.toMatch(/candidate|cheat|suspic|risk|violation/i)
  })
})
