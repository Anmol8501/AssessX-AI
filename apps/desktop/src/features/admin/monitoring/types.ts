/**
 * Wire shapes and status vocabulary for admin live monitoring (Phase 4C).
 *
 * Everything here is factual technical state — device/session status and proctoring events. There
 * is no risk, suspicion or verdict, and there never should be. Phase 5C adds the on-device AI's
 * factual state (`ai`), derived by the server from the AI episode and AI_STATUS events; a `confidence`
 * in its metadata is the model's detection confidence, never a probability of misconduct.
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
  /** The on-device AI's factual state (Phase 5C). */
  ai: AIMonitoringState
}

export type AIStatus = 'INITIALIZING' | 'RUNNING' | 'DEGRADED' | 'ERROR' | 'STOPPED'

/** An AI observation episode that has started and not yet resolved. */
export interface AIActiveObservation {
  eventType: string
  startedAt: string
  metadata: Record<string, unknown>
}

/** `backend/app/schemas/monitoring.py::AIMonitoringState`. "unknown" whenever the AI is not measuring it. */
export interface AIMonitoringState {
  /** The latest reported AI health, or null if the candidate's app has reported none. */
  status: AIStatus | null
  reason: string | null
  impaired: string[]
  face: 'detected' | 'not_detected' | 'unknown'
  faceCount: 'one' | 'multiple' | 'none' | 'unknown'
  /** forward, a direction (left/right) relative to the candidate's calibrated neutral, or unknown. */
  headOrientation: string
  /** Always `not_used`: gaze is not an event signal (GAZE_AWAY is disabled). Not shown as an indicator. */
  gaze: 'not_used'
  cameraQuality: 'good' | 'issue' | 'unknown'
  active: AIActiveObservation[]
}

const NO_AI: AIMonitoringState = {
  status: null,
  reason: null,
  impaired: [],
  face: 'unknown',
  faceCount: 'unknown',
  headOrientation: 'unknown',
  gaze: 'not_used',
  cameraQuality: 'unknown',
  active: [],
}

export function toAI(raw: Record<string, unknown> | null | undefined): AIMonitoringState {
  if (!raw) return NO_AI
  return {
    status: (raw.status as AIStatus | null) ?? null,
    reason: (raw.reason as string | null) ?? null,
    impaired: (raw.impaired as string[] | undefined) ?? [],
    face: (raw.face as AIMonitoringState['face']) ?? 'unknown',
    faceCount: (raw.face_count as AIMonitoringState['faceCount']) ?? 'unknown',
    headOrientation: (raw.head_orientation as string) ?? 'unknown',
    gaze: 'not_used',
    cameraQuality: (raw.camera_quality as AIMonitoringState['cameraQuality']) ?? 'unknown',
    active: ((raw.active as Record<string, unknown>[] | undefined) ?? []).map((item) => ({
      eventType: item.event_type as string,
      startedAt: item.started_at as string,
      metadata: (item.metadata as Record<string, unknown>) ?? {},
    })),
  }
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
    ai: toAI(raw.ai as Record<string, unknown> | undefined),
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
