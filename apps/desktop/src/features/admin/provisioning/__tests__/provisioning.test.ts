import { describe, expect, it } from 'vitest'
import {
  getChangeJournal,
  getDeviceIdentity,
  getDiagnosticReport,
  getHardwareReadiness,
  getPrivilegeStatus,
  getProvisioningPlan,
  getWindowsCompatibility,
  getWindowsSecurity,
  inspectCandidateAccount,
  reEnrollDeviceIdentity,
  runFullDeviceScan,
  validateConfiguration,
} from '../provisioning'

describe('Phase 1A: Windows Provisioning & Readiness Bridge', () => {
  it('evaluates Windows compatibility structure (Module 1)', async () => {
    const report = await getWindowsCompatibility()
    expect(report).toBeDefined()
    expect(report.platform).toBeDefined()
    expect(report.edition).toBeDefined()
    expect(['SUPPORTED', 'WARNING', 'UNSUPPORTED']).toContain(report.compatibility)
    expect(Array.isArray(report.warnings)).toBe(true)
  })

  it('scans hardware readiness metrics (Module 2)', async () => {
    const hardware = await getHardwareReadiness()
    expect(hardware).toBeDefined()
    expect(hardware.cpu.logicalCores).toBeGreaterThanOrEqual(1)
    expect(['PASS', 'WARNING', 'FAIL']).toContain(hardware.cpu.status)
    expect(['PASS', 'WARNING', 'FAIL']).toContain(hardware.memory.status)
    expect(['PASS', 'WARNING', 'FAIL']).toContain(hardware.storage.status)
    expect(['PASS', 'WARNING', 'FAIL']).toContain(hardware.display.status)
    expect(['PASS', 'WARNING', 'FAIL']).toContain(hardware.overallStatus)
  })

  it('checks Windows security controls (Module 3)', async () => {
    const sec = await getWindowsSecurity()
    expect(sec).toBeDefined()
    expect(sec.secureBoot.name).toBe('Secure Boot')
    expect(sec.tpm.name).toContain('TPM')
    expect(sec.firewall.name).toContain('Firewall')
    expect(sec.antivirus.name).toContain('Antivirus')
    expect(['PASS', 'WARNING', 'FAIL']).toContain(sec.overallStatus)
  })

  it('evaluates privilege elevation state (Module 4)', async () => {
    const priv = await getPrivilegeStatus()
    expect(priv).toBeDefined()
    expect(typeof priv.isElevated).toBe('boolean')
    expect(['ADMINISTRATOR', 'STANDARD_USER']).toContain(priv.privilegeLevel)
  })

  it('inspects candidate account and generates provisioning plan (Module 5)', async () => {
    const acc = await inspectCandidateAccount('AssessXCandidate')
    expect(acc).toBeDefined()
    expect(acc.accountName).toBe('AssessXCandidate')
    expect(['READY', 'NEEDS_PROVISIONING', 'WARNING_IS_ADMIN', 'NOT_FOUND']).toContain(acc.status)

    const plan = await getProvisioningPlan('AssessXCandidate')
    expect(plan).toBeDefined()
    expect(plan.targetAccount).toBe('AssessXCandidate')
    expect(plan.steps.length).toBeGreaterThanOrEqual(1)
    expect(typeof plan.requiresAdminApproval).toBe('boolean')
  })

  it('manages persistent cryptographic device identity (Module 6)', async () => {
    const id = await getDeviceIdentity()
    expect(id).toBeDefined()
    expect(id.deviceId.length).toBeGreaterThanOrEqual(16)
    expect(id.hostname.length).toBeGreaterThanOrEqual(1)

    const reEnrolled = await reEnrollDeviceIdentity()
    expect(reEnrolled).toBeDefined()
    expect(reEnrolled.deviceId).toBeDefined()
  })

  it('validates configuration and binary integrity (Module 8)', async () => {
    const val = await validateConfiguration()
    expect(val).toBeDefined()
    expect(val.checks.length).toBeGreaterThanOrEqual(1)
    expect(['READY', 'READY_WITH_WARNINGS', 'NOT_READY']).toContain(val.overallStatus)
  })

  it('generates scrubbed diagnostic report (Module 9)', async () => {
    const diag = await getDiagnosticReport('AssessXCandidate')
    expect(diag).toBeDefined()
    expect(diag.diagnosticId).toBeDefined()
    expect(diag.deviceIdentity).toBeDefined()
    expect(['PASS', 'WARNING', 'FAIL']).toContain(diag.overallStatus)
    expect(Array.isArray(diag.warnings)).toBe(true)
    expect(Array.isArray(diag.failures)).toBe(true)
  })

  it('loads change journal history (Module 10)', async () => {
    const journal = await getChangeJournal()
    expect(journal).toBeDefined()
    expect(Array.isArray(journal.entries)).toBe(true)
  })

  it('runs full unified scan', async () => {
    const scan = await runFullDeviceScan()
    expect(scan).toBeDefined()
    expect(scan.compatibility).toBeDefined()
    expect(scan.hardware).toBeDefined()
    expect(scan.security).toBeDefined()
    expect(scan.privileges).toBeDefined()
    expect(['READY', 'READY_WITH_WARNINGS', 'NOT_READY']).toContain(scan.overallReadiness)
  })
})
