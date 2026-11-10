import { describe, expect, it } from 'vitest'
import {
  checkCandidateEligibility,
  runNativeReadiness,
  requestStartAuthorization,
  bindNativeSessionPolicy,
  activateAuthorizedSession,
  resolveExamStartAction,
} from '../sessionActivation'

describe('Phase 3A: Examination Activation & Start Authorization Client', () => {
  it('runs native pre-flight readiness evaluation with fallback support', async () => {
    const report = await runNativeReadiness()
    expect(report).toBeDefined()
    expect(report.device_identifier).toBeDefined()
    expect(report.agent_version).toBeDefined()
    expect(report.checks.length).toBeGreaterThanOrEqual(3)
    expect(['READY', 'NOT_READY', 'WARNING']).toContain(report.overall_status)

    const checkIds = report.checks.map((c) => c.check_id)
    expect(checkIds).toContain('agent_health')
    expect(checkIds).toContain('shell_kiosk')
    expect(checkIds).toContain('single_monitor_check')
  })

  it('binds native session policy safely via Tauri invoke', async () => {
    const result = await bindNativeSessionPolicy('sess-test-uuid', 1, 'exam-test-uuid')
    expect(result).toBeDefined()
    expect(result.bound).toBe(true)
    expect(result.session_id).toBe('sess-test-uuid')
    expect(result.policy_version).toBe(1)
    expect(['ARMED', 'ARMED_LOCAL', 'ARMED_WEB']).toContain(result.status)
  })

  it('exports eligibility and authorization API bridge methods', () => {
    expect(typeof checkCandidateEligibility).toBe('function')
    expect(typeof requestStartAuthorization).toBe('function')
    expect(typeof activateAuthorizedSession).toBe('function')
  })

  it('preserves standard browser, proctored check-before-clock, and registered-device workflows', () => {
    expect(
      resolveExamStartAction({
        resuming: false,
        proctoringRequired: false,
        requireRegisteredDevice: false,
      }),
    ).toBe('START_STANDARD')

    expect(
      resolveExamStartAction({
        resuming: false,
        proctoringRequired: true,
        requireRegisteredDevice: false,
      }),
    ).toBe('START_PROCTORED')

    expect(
      resolveExamStartAction({
        resuming: false,
        proctoringRequired: false,
        requireRegisteredDevice: true,
      }),
    ).toBe('PREFLIGHT_MODAL')

    expect(
      resolveExamStartAction({
        resuming: false,
        proctoringRequired: true,
        requireRegisteredDevice: true,
      }),
    ).toBe('PREFLIGHT_MODAL')

    expect(
      resolveExamStartAction({
        resuming: true,
        proctoringRequired: true,
        requireRegisteredDevice: false,
      }),
    ).toBe('RESUME_PROCTORED')

    expect(
      resolveExamStartAction({
        resuming: true,
        proctoringRequired: false,
        requireRegisteredDevice: true,
      }),
    ).toBe('START_STANDARD')
  })
})

