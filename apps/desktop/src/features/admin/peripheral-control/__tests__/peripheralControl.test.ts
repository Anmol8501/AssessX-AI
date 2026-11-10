import { describe, expect, it } from 'vitest'
import {
  applyPeripheralPolicy,
  getPeripheralPolicy,
  inspectDisplayTopology,
  inspectRemoteAccessStatus,
  inspectStorageStatus,
  previewPeripheralPolicy,
  rollbackPeripheralPolicy,
  scanPeripheralViolations,
  validateAndSavePeripheralPolicy,
} from '../peripheralControl'

describe('Phase 2D: Peripheral, Display & Remote Access Control Bridge', () => {
  it('inspects USB and removable storage status report', async () => {
    const report = await inspectStorageStatus()
    expect(report).toBeDefined()
    expect(report.activeMode).toBeDefined()
    expect(typeof report.connectedRemovableDrivesCount).toBe('number')
    expect(Array.isArray(report.removableDrives)).toBe(true)
    expect(typeof report.isPolicyEnforced).toBe('boolean')
  })

  it('inspects display topology and peripheral readiness report', async () => {
    const report = await inspectDisplayTopology()
    expect(report).toBeDefined()
    expect(report.monitorCount).toBeGreaterThanOrEqual(1)
    expect(report.primaryWidth).toBeGreaterThan(0)
    expect(report.primaryHeight).toBeGreaterThan(0)
    expect(Array.isArray(report.monitors)).toBe(true)
    expect(report.peripherals.keyboardDetected).toBe(true)
    expect(report.peripherals.mouseDetected).toBe(true)
  })

  it('inspects remote-access status report', async () => {
    const report = await inspectRemoteAccessStatus()
    expect(report).toBeDefined()
    expect(typeof report.isRemoteSessionActive).toBe('boolean')
    expect(typeof report.rdpDeniedByPolicy).toBe('boolean')
    expect(Array.isArray(report.detectedRemoteTools)).toBe(true)
    expect(typeof report.isEnvironmentSecure).toBe('boolean')
  })

  it('retrieves active peripheral policy config', async () => {
    const policy = await getPeripheralPolicy()
    expect(policy).toBeDefined()
    expect(policy.version).toBeGreaterThanOrEqual(1)
    expect(policy.maxMonitors).toBe(1)
    expect(policy.state).toBe('Active')
  })

  it('previews peripheral policy impact', async () => {
    const policy = await getPeripheralPolicy()
    const preview = await previewPeripheralPolicy(policy)
    expect(preview).toBeDefined()
    expect(preview.maxAllowedMonitors).toBe(1)
    expect(typeof preview.removableDrivesAffectedCount).toBe('number')
    expect(Array.isArray(preview.conflicts)).toBe(true)
  })

  it('validates, applies, and rolls back peripheral policy', async () => {
    const policy = await getPeripheralPolicy()
    const validateRes = await validateAndSavePeripheralPolicy(policy)
    expect(validateRes.success).toBe(true)
    expect(validateRes.state).toBe('Validated')

    const applyRes = await applyPeripheralPolicy('ADMIN_SIGNATURE_VERIFIED')
    expect(applyRes.success).toBe(true)
    expect(applyRes.state).toBe('Active')

    const rollbackRes = await rollbackPeripheralPolicy()
    expect(rollbackRes.success).toBe(true)
    expect(rollbackRes.state).toBe('RolledBack')
  })

  it('scans peripheral, display and remote violations', async () => {
    const summary = await scanPeripheralViolations()
    expect(summary).toBeDefined()
    expect(typeof summary.isEnvironmentCompliant).toBe('boolean')
    expect(typeof summary.violationsCount).toBe('number')
    expect(summary.storageReport).toBeDefined()
    expect(summary.displayReport).toBeDefined()
    expect(summary.remoteReport).toBeDefined()
  })
})

