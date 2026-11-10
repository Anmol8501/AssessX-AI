import { describe, expect, it } from 'vitest'
import {
  flushSecurityAgentEvents,
  getAgentRecoveryStatus,
  getAgentTamperEvents,
  getDeviceComplianceReport,
  getSecurityAgentStatus,
  installSecurityAgentService,
  resetAgentRecovery,
  sendAgentHeartbeat,
  startSecurityAgentDaemon,
  stopSecurityAgentDaemon,
  uninstallSecurityAgentService,
  verifyComponentIntegrity,
} from '../securityAgent'

describe('Phase 1C: Native Security Agent Bridge', () => {
  it('queries Security Agent status', async () => {
    const status = await getSecurityAgentStatus()
    expect(status).toBeDefined()
    expect(status.serviceName).toBe('AssessXSecurityAgent')
    expect(['NotInstalled', 'Stopped', 'Starting', 'Running', 'Degraded', 'Stopping', 'Failed']).toContain(
      status.state
    )
  })

  it('controls in-process daemon mode', async () => {
    const started = await startSecurityAgentDaemon()
    expect(started).toBeDefined()
    expect(started.state).toBe('Running')

    const stopped = await stopSecurityAgentDaemon()
    expect(stopped).toBeDefined()
  })

  it('evaluates device compliance against policy v1.0', async () => {
    const report = await getDeviceComplianceReport()
    expect(report).toBeDefined()
    expect(report.policy_version).toBe('1.0.0')
    expect(['COMPLIANT', 'NON_COMPLIANT', 'WARNING', 'UNKNOWN']).toContain(report.overall_status)
    expect(report.results.length).toBeGreaterThan(0)
    for (const rule of report.results) {
      expect(['PASS', 'FAIL', 'WARNING']).toContain(rule.status)
      expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(rule.severity)
    }
  })

  it('verifies component SHA-256 integrity digests', async () => {
    const report = await verifyComponentIntegrity()
    expect(report).toBeDefined()
    expect(typeof report.overall_valid).toBe('boolean')
    expect(report.components.length).toBeGreaterThan(0)
    for (const comp of report.components) {
      expect(['VALID', 'MISMATCH', 'FILE_NOT_FOUND', 'UNREADABLE']).toContain(comp.status)
    }
  })

  it('manages tamper detection and recovery coordinator', async () => {
    const events = await getAgentTamperEvents()
    expect(Array.isArray(events)).toBe(true)

    const recovery = await getAgentRecoveryStatus()
    expect(recovery).toBeDefined()
    expect(recovery.max_restarts).toBe(3)
    expect(recovery.cooldown_seconds).toBe(600)

    const resetSuccess = await resetAgentRecovery()
    expect(resetSuccess).toBe(true)
  })

  it('handles heartbeat emission and event flushing', async () => {
    const beat = await sendAgentHeartbeat('test-session-id')
    expect(beat).toBe(true)

    const flushed = await flushSecurityAgentEvents('http://localhost:8000')
    expect(typeof flushed).toBe('number')
  })

  it('supports SCM service registration interfaces', async () => {
    const installMsg = await installSecurityAgentService()
    expect(typeof installMsg).toBe('string')

    const uninstallMsg = await uninstallSecurityAgentService()
    expect(typeof uninstallMsg).toBe('string')
  })
})

