import { describe, expect, it } from 'vitest'
import {
  applyNavigationPolicy,
  getNavigationPolicy,
  getShortcutCatalog,
  inspectAccessibilityStatus,
  inspectNavigationStatus,
  inspectWindowFocus,
  previewNavigationPolicy,
  rollbackNavigationPolicy,
  scanNavigationViolations,
  validateAndSaveNavigationPolicy,
} from '../navigationControl'

describe('Phase 2C: Navigation & Keyboard Shortcut Restrictions Bridge', () => {
  it('retrieves shortcut inventory catalog with Categories A through G', async () => {
    const catalog = await getShortcutCatalog()
    expect(catalog).toBeDefined()
    expect(Array.isArray(catalog)).toBe(true)
    expect(catalog.length).toBeGreaterThan(0)

    const altTab = catalog.find((s) => s.keyCombination.includes('Alt + Tab'))
    expect(altTab).toBeDefined()
    expect(altTab?.category).toBe('ApplicationSwitching')
    expect(altTab?.defaultAction).toBe('Block')

    const sas = catalog.find((s) => s.keyCombination.includes('Ctrl + Alt + Delete'))
    expect(sas).toBeDefined()
    expect(sas?.category).toBe('TaskAndSessionControl')
    expect(sas?.isKernelRestricted).toBe(true)
    expect(sas?.defaultAction).toBe('KernelRestricted')

    const winR = catalog.find((s) => s.keyCombination.includes('Win + R'))
    expect(winR).toBeDefined()
    expect(winR?.category).toBe('ShellAndDesktopNavigation')

    const sticky = catalog.find((s) => s.category === 'AccessibilityAndSpecialKeys')
    expect(sticky).toBeDefined()
    expect(sticky?.defaultAction).toBe('Allow')
  })

  it('retrieves default active navigation control policy', async () => {
    const policy = await getNavigationPolicy()
    expect(policy).toBeDefined()
    expect(policy.version).toBeGreaterThanOrEqual(1)
    expect(typeof policy.windowsKeysBlocked).toBe('boolean')
    expect(typeof policy.runDialogBlocked).toBe('boolean')
    expect(policy.state).toBe('Active')
  })

  it('previews navigation policy impact with accessibility accommodation preservation', async () => {
    const policy = await getNavigationPolicy()
    const preview = await previewNavigationPolicy(policy, {
      stickyKeysPermitted: true,
      filterKeysPermitted: true,
      toggleKeysPermitted: true,
      highContrastPermitted: true,
      screenReaderActive: false,
      magnifierActive: false,
      accommodationNotes: null,
    })

    expect(preview).toBeDefined()
    expect(preview.totalShortcutsCovered).toBeGreaterThan(0)
    expect(preview.blockedCount).toBeGreaterThan(0)
    expect(preview.kernelRestrictedCount).toBeGreaterThan(0)
    expect(preview.accommodationsPreserved).toBe(true)
  })

  it('validates and applies navigation policy lifecycle', async () => {
    const policy = await getNavigationPolicy()
    const validateRes = await validateAndSaveNavigationPolicy(policy)
    expect(validateRes.success).toBe(true)
    expect(validateRes.state).toBe('Validated')

    const applyRes = await applyNavigationPolicy('ADMIN_SIGNATURE_VERIFIED')
    expect(applyRes.success).toBe(true)
    expect(applyRes.state).toBe('Active')

    const rollbackRes = await rollbackNavigationPolicy()
    expect(rollbackRes.success).toBe(true)
    expect(rollbackRes.state).toBe('RolledBack')
  })

  it('inspects window focus supervisor state', async () => {
    const focus = await inspectWindowFocus()
    expect(focus).toBeDefined()
    expect(focus.targetClass).toBeDefined()
    expect(typeof focus.lossOfFocusCount).toBe('number')
    expect(typeof focus.isExamWindowForeground).toBe('boolean')
  })

  it('inspects Windows Explorer navigation status', async () => {
    const nav = await inspectNavigationStatus()
    expect(nav).toBeDefined()
    expect(typeof nav.windowsKeysBlocked).toBe('boolean')
    expect(typeof nav.runDialogBlocked).toBe('boolean')
    expect(typeof nav.allShellPoliciesEnforced).toBe('boolean')
  })

  it('inspects Windows accessibility subsystem status', async () => {
    const acc = await inspectAccessibilityStatus()
    expect(acc).toBeDefined()
    expect(typeof acc.stickyKeysDetected).toBe('boolean')
    expect(typeof acc.accommodationsActiveCount).toBe('number')
  })

  it('scans navigation and focus violations', async () => {
    const summary = await scanNavigationViolations()
    expect(summary).toBeDefined()
    expect(typeof summary.isEnvironmentCompliant).toBe('boolean')
    expect(typeof summary.violationsCount).toBe('number')
    expect(Array.isArray(summary.violations)).toBe(true)
  })
})

