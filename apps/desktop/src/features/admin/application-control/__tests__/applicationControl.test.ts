import { describe, expect, it } from 'vitest'
import {
  addAllowlistRule,
  applyApplicationPolicy,
  getEnforcementCapabilities,
  getApplicationAllowlist,
  getApplicationInventory,
  getPolicyState,
  previewApplicationPolicy,
  removeAllowlistRule,
  restoreApplicationPolicyBaseline,
  scanApplicationViolations,
} from '../applicationControl'

describe('Phase 2A: Application Allowlisting & Execution Control Bridge', () => {
  it('discovers running application inventory with normalized identities', async () => {
    const apps = await getApplicationInventory()
    expect(apps).toBeDefined()
    expect(Array.isArray(apps)).toBe(true)
    expect(apps.length).toBeGreaterThan(0)

    const first = apps[0]
    expect(first).toBeDefined()
    if (!first) return
    expect(first.applicationId).toBeDefined()
    expect(first.executableName).toBeDefined()
    expect(first.fileHash).toBeDefined()
    expect(typeof first.isRunning).toBe('boolean')
  })

  it('retrieves active allowlist rules including system baseline', async () => {
    const rules = await getApplicationAllowlist()
    expect(rules).toBeDefined()
    expect(rules.length).toBeGreaterThanOrEqual(3)

    const coreApp = rules.find((r) => r.ruleValue === 'AssessX.exe')
    expect(coreApp).toBeDefined()
    expect(coreApp?.action).toBe('Allow')
    expect(coreApp?.isSystemRule).toBe(true)

    const blockedChrome = rules.find((r) => r.ruleValue === 'chrome.exe')
    expect(blockedChrome).toBeDefined()
    expect(blockedChrome?.action).toBe('Deny')
  })

  it('manages custom allowlist rules (add and remove)', async () => {
    const newRule = await addAllowlistRule(
      'Calculator Test App',
      'ApprovedSupport',
      'ExecutableName',
      'calc_test.exe',
      'Allow',
      'Test approved calculation utility'
    )
    expect(newRule).toBeDefined()
    expect(newRule.name).toBe('Calculator Test App')
    expect(newRule.action).toBe('Allow')
    expect(newRule.isSystemRule).toBe(false)

    const removed = await removeAllowlistRule(newRule.id)
    expect(removed).toBe(true)
  })

  it('detects Windows application control capabilities', async () => {
    const caps = await getEnforcementCapabilities()
    expect(caps).toBeDefined()
    expect(caps.windowsEdition).toBeDefined()
    expect(caps.windowsBuild).toBeDefined()
    expect(['Wdac', 'AppLocker', 'ProcessSupervision', 'None']).toContain(caps.primaryMechanism)
    expect(['Supported', 'PartiallySupported', 'RequiresAdmin', 'Unsupported']).toContain(caps.status)
    expect(typeof caps.isEnforcementCapable).toBe('boolean')
  })

  it('queries policy state, previews changes, and validates safety', async () => {
    const state = await getPolicyState()
    expect(state).toBeDefined()
    expect(state.policyId).toBeDefined()
    expect(['AuditMode', 'EnforcementMode']).toContain(state.mode)

    const preview = await previewApplicationPolicy('EnforcementMode')
    expect(preview).toBeDefined()
    expect(preview.isSafeToApply).toBe(true)
    expect(preview.allowedCount).toBeGreaterThan(0)
    expect(preview.deniedCount).toBeGreaterThan(0)
    expect(preview.plannedActions.length).toBeGreaterThan(0)
  })

  it('enforces administrator approval gate when applying policies', async () => {
    // Unapproved
    const unapproved = await applyApplicationPolicy('EnforcementMode', false)
    expect(unapproved.success).toBe(false)
    expect(unapproved.currentState).toBe('AwaitingAdminApproval')

    // Approved
    const approved = await applyApplicationPolicy('EnforcementMode', true)
    expect(approved.success).toBe(true)
    expect(approved.currentState).toBe('Active')

    // Restore baseline
    const restored = await restoreApplicationPolicyBaseline()
    expect(restored.success).toBe(true)
    expect(restored.currentState).toBe('Draft')
  })

  it('scans running processes for application violations', async () => {
    const scan = await scanApplicationViolations()
    expect(scan).toBeDefined()
    expect(scan.totalScanned).toBeGreaterThan(0)
    expect(typeof scan.hasViolations).toBe('boolean')
    expect(Array.isArray(scan.violations)).toBe(true)
  })
})
