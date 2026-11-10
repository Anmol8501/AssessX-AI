import { useCallback } from 'react'
import { useApi } from '@/features/session'
import type { AttemptDetail, DeviceState, ProctoringSession } from '@/features/exam/types'

const ME = '/api/v1/candidates/me'

export interface DeviceReport {
  camera: DeviceState
  microphone: DeviceState
  selected_camera_id?: string | null
  selected_camera_label?: string | null
  selected_microphone_id?: string | null
  selected_microphone_label?: string | null
  readiness_state?: string | null
  device_failure_reason?: string | null
  /** On activation: whether this app can record evidence clips (FR-017). */
  evidence_recorder?: boolean
}

export interface ProctoringInterruptionIn {
  device_type: 'camera' | 'microphone'
  reason: string
  message?: string | null
}

export interface ProctoringStopOut {
  attempt_id: string
  status: string
  stopped_at: string
}

/**
 * The candidate's proctoring calls (`backend/app/api/v1/proctoring.py`).
 *
 * These throw rather than holding their own error state: the proctored-exam flow chains them
 * (start the attempt, then activate) and has to decide per step what a failure means.
 */
export function useProctoringApi() {
  const api = useApi()

  const startAttempt = useCallback(
    (assessmentId: string) =>
      api<AttemptDetail>(`${ME}/assessments/${assessmentId}/attempts`, { method: 'POST' }),
    [api],
  )

  const getProctoring = useCallback(
    (attemptId: string) =>
      api<ProctoringSession>(`${ME}/attempts/${attemptId}/proctoring`),
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

  const reportReadiness = useCallback(
    (attemptId: string, devices: DeviceReport) =>
      api<ProctoringSession>(`${ME}/attempts/${attemptId}/proctoring/readiness`, { method: 'POST', body: devices }),
    [api],
  )

  const reportInterruption = useCallback(
    (attemptId: string, interruption: ProctoringInterruptionIn) =>
      api<ProctoringSession>(`${ME}/attempts/${attemptId}/proctoring/interruption`, { method: 'POST', body: interruption }),
    [api],
  )

  const stopProctoring = useCallback(
    (attemptId: string) =>
      api<ProctoringStopOut>(`${ME}/attempts/${attemptId}/proctoring/stop`, { method: 'POST' }),
    [api],
  )

  return {
    startAttempt,
    getProctoring,
    activate,
    reportDevices,
    reportReadiness,
    reportInterruption,
    stopProctoring,
  }
}
