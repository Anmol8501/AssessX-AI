import { useCallback } from 'react'
import { useApi } from '@/features/session'
import type { AttemptDetail, DeviceState, ProctoringSession } from '@/features/exam/types'

const ME = '/api/v1/candidates/me'

export interface DeviceReport {
  camera: DeviceState
  microphone: DeviceState
}

/**
 * The candidate's proctoring calls (`backend/app/api/v1/proctoring.py`).
 *
 * These throw rather than holding their own error state: the proctored-exam flow chains them
 * (start the attempt, then activate) and has to decide per step what a failure means.
 *
 * There is no "end session" call — the server ends a session when its attempt is submitted or
 * runs out of time.
 */
export function useProctoringApi() {
  const api = useApi()

  const startAttempt = useCallback(
    (assessmentId: string) =>
      api<AttemptDetail>(`${ME}/assessments/${assessmentId}/attempts`, { method: 'POST' }),
    [api],
  )

  const activate = useCallback(
    (attemptId: string, devices: DeviceReport) =>
      api<ProctoringSession>(`${ME}/attempts/${attemptId}/proctoring/activate`, { method: 'POST', body: devices }),
    [api],
  )

  const reportDevices = useCallback(
    (attemptId: string, devices: DeviceReport) =>
      api<ProctoringSession>(`${ME}/attempts/${attemptId}/proctoring/devices`, { method: 'PUT', body: devices }),
    [api],
  )

  return { startAttempt, activate, reportDevices }
}
