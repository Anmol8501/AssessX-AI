/**
 * Wire shapes and status vocabulary for admin live monitoring (Phase 4C).
 *
 * Everything here is factual technical state — device/session status and proctoring events. There
 * is no risk, suspicion, confidence or verdict, and there never should be: Phase 4C has no AI.
 */

import type { DeviceState } from '@/features/exam/types'

export type ProctoringSessionStatus = 'NOT_STARTED' | 'ACTIVE' | 'ENDED'
export type AttemptStatus = 'IN_PROGRESS' | 'SUBMITTED' | 'TIME_EXPIRED'

/** A candidate tile on the wall (`backend/app/schemas/monitoring.py::MonitoringSession`). */
export interface MonitoringSession {
  attemptId: string
  proctoringSessionId: string
  candidateId: string
  candidateName: string
  candidateRollNumber: string | null
  assessmentId: string
  assessmentTitle: string
  attemptStatus: AttemptStatus
  proctoringStatus: ProctoringSessionStatus
  cameraState: DeviceState
  microphoneState: DeviceState
  /** True fullscreen, false exited, null unknown — derived from the latest window event. */
  fullscreen: boolean | null
  startedAt: string | null
  devicesReportedAt: string | null
}

export interface MonitoringSummary {
  activeSessions: number
  camerasReady: number
  cameraIssues: number
  microphoneIssues: number
}

export interface MonitoringEvent {
  id: string
  eventType: string
  category: string
  metadata: Record<string, unknown>
  recordedAt: string
}

export interface MonitoringDetail extends MonitoringSession {
  recentEvents: MonitoringEvent[]
}

/** The backend serialises snake_case; these map it to the camelCase shapes above. */
export function toSession(raw: Record<string, unknown>): MonitoringSession {
  return {
    attemptId: raw.attempt_id as string,
    proctoringSessionId: raw.proctoring_session_id as string,
    candidateId: raw.candidate_id as string,
    candidateName: raw.candidate_name as string,
    candidateRollNumber: (raw.candidate_roll_number as string | null) ?? null,
    assessmentId: raw.assessment_id as string,
    assessmentTitle: raw.assessment_title as string,
    attemptStatus: raw.attempt_status as AttemptStatus,
    proctoringStatus: raw.proctoring_status as ProctoringSessionStatus,
    cameraState: raw.camera_state as DeviceState,
    microphoneState: raw.microphone_state as DeviceState,
    fullscreen: (raw.fullscreen as boolean | null) ?? null,
    startedAt: (raw.started_at as string | null) ?? null,
    devicesReportedAt: (raw.devices_reported_at as string | null) ?? null,
  }
}

export function toEvent(raw: Record<string, unknown>): MonitoringEvent {
  return {
    id: raw.id as string,
    eventType: raw.event_type as string,
    category: raw.category as string,
    metadata: (raw.metadata as Record<string, unknown>) ?? {},
    recordedAt: raw.recorded_at as string,
  }
}
