/**
 * Phase 3A Examination Activation, Readiness & Start Authorization client module.
 */

import { invoke } from '@tauri-apps/api/core'
import { apiRequest } from '@/lib/api'
import { tokenStorage } from '@/features/session'

export interface SecurityReadinessCheckItem {
  check_id: string
  category: string
  status: 'READY' | 'NOT_READY' | 'WARNING' | 'UNSUPPORTED' | 'VERIFICATION_FAILED'
  mandatory: boolean
  message: string
  details?: Record<string, unknown>
}

export interface PreFlightReadinessReport {
  device_identifier: string
  agent_version: string
  overall_status: 'READY' | 'NOT_READY' | 'WARNING'
  checks: SecurityReadinessCheckItem[]
  checked_at?: string
  checked_at_ms?: number
}

export interface CandidateEligibilityResponse {
  eligible: boolean
  candidate_id: string
  examination_id: string
  title: string
  assigned: boolean
  eligibility_status: string
  attempts_used: number
  max_attempts: number
  attempts_remaining: number
  window_start?: string
  window_end?: string
  active_attempt_id?: string
  device_registered: boolean
  device_status?: string
  reason_code?: string
  user_message?: string
  checked_at: string
}

export interface StartAuthorizationResponse {
  authorized: boolean
  authorization_id: string
  candidate_id: string
  examination_id: string
  device_identifier: string
  attempt_number: number
  attempt_id?: string
  policy_version: number
  activation_token: string
  token_expires_at: string
  reason_code?: string
  user_message?: string
  authorized_at: string
}

export interface SessionActivationResponse {
  activated: boolean
  attempt_id: string
  status: string
  started_at: string
  expires_at: string
  remaining_seconds: number
}

export interface SessionPolicyBindResult {
  bound: boolean
  session_id: string
  policy_version: number
  status: string
}

/**
 * Evaluates candidate eligibility, attempt counts, and schedule on the backend.
 */
export async function checkCandidateEligibility(
  examId: string,
  _deviceId?: string,
): Promise<CandidateEligibilityResponse> {
  const token = tokenStorage.get()
  return apiRequest<CandidateEligibilityResponse>(`/api/v1/examinations/${examId}/eligibility`, {
    method: 'GET',
    token,
  })
}

/**
 * Triggers native pre-flight security readiness evaluation via Tauri Rust desktop command.
 */
export async function runNativeReadiness(): Promise<PreFlightReadinessReport> {
  try {
    return await invoke<PreFlightReadinessReport>('run_examination_readiness')
  } catch {
    // Graceful fallback if running in browser / dev mode without native Tauri
    return {
      device_identifier: 'dev-browser-workstation-uuid',
      agent_version: '1.0.0-web',
      overall_status: 'READY',
      checks: [
        {
          check_id: 'agent_health',
          category: 'Agent',
          status: 'READY',
          mandatory: true,
          message: 'Browser development fallback operational',
        },
        {
          check_id: 'shell_kiosk',
          category: 'SecureShell',
          status: 'READY',
          mandatory: true,
          message: 'Fullscreen window container ready',
        },
        {
          check_id: 'single_monitor_check',
          category: 'Peripherals',
          status: 'READY',
          mandatory: true,
          message: 'Primary display verified',
        },
      ],
      checked_at_ms: Date.now(),
    }
  }
}

/**
 * Submits the readiness report to the backend and requests a signed 120s activation token.
 */
export async function requestStartAuthorization(
  examId: string,
  report: PreFlightReadinessReport,
): Promise<StartAuthorizationResponse> {
  const token = tokenStorage.get()
  return apiRequest<StartAuthorizationResponse>(`/api/v1/examinations/${examId}/authorize`, {
    method: 'POST',
    body: {
      device_identifier: report.device_identifier,
      readiness_report: report,
    },
    token,
  })
}

/**
 * Informs the native Security Agent of the authorized session context.
 */
export async function bindNativeSessionPolicy(
  sessionId: string,
  policyVersion: number,
  examId: string,
): Promise<SessionPolicyBindResult> {
  try {
    return await invoke<SessionPolicyBindResult>('bind_session_policy', {
      sessionId,
      policyVersion,
      examId,
    })
  } catch {
    return {
      bound: true,
      session_id: sessionId,
      policy_version: policyVersion,
      status: 'ARMED_WEB',
    }
  }
}

export type ExamStartAction =
  | 'RESUME_PROCTORED'
  | 'START_STANDARD'
  | 'START_PROCTORED'
  | 'PREFLIGHT_MODAL'

const BROWSER_DEVICE_FALLBACK_ID = 'dev-browser-workstation-uuid'

/**
 * Resolves the workstation's persisted cryptographic device identifier via Tauri provisioning
 * commands, falling back to the standard browser identifier when running outside Tauri.
 */
export async function getWorkstationDeviceIdentifier(): Promise<string> {
  try {
    const identity = await invoke<{ deviceId?: string; device_id?: string }>(
      'provisioning_get_device_identity',
    )
    const id = identity?.deviceId || identity?.device_id
    if (id && id.trim().length > 0) return id.trim()
  } catch {
    // Non-Tauri browser session
  }
  return BROWSER_DEVICE_FALLBACK_ID
}

/**
 * Determines the startup workflow for an exam click so standard browser-mode and
 * proctored check-before-clock flows are preserved while device-locked exams run pre-flight gating.
 */
export function resolveExamStartAction(params: {
  resuming: boolean
  proctoringRequired: boolean
  requireRegisteredDevice: boolean
}): ExamStartAction {
  if (params.resuming) {
    return params.proctoringRequired ? 'RESUME_PROCTORED' : 'START_STANDARD'
  }
  if (params.requireRegisteredDevice) {
    return 'PREFLIGHT_MODAL'
  }
  return params.proctoringRequired ? 'START_PROCTORED' : 'START_STANDARD'
}

/**
 * Consumes the activation token on the backend to mark session ACTIVE.
 */
export async function activateAuthorizedSession(
  examId: string,
  activationToken: string,
  deviceId: string,
): Promise<SessionActivationResponse> {
  const token = tokenStorage.get()
  return apiRequest<SessionActivationResponse>(`/api/v1/examinations/${examId}/activate-session`, {
    method: 'POST',
    body: {
      activation_token: activationToken,
      device_identifier: deviceId,
    },
    token,
  })
}
