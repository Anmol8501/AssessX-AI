import { describe, expect, it } from 'vitest'
import {
  applyCmdPolicy,
  applyPowerShellPolicy,
  applySystemUtilityPolicy,
  applyTaskManagerPolicy,
  getSystemUtilityInventory,
  getSystemUtilityPolicy,
  inspectCmdStatus,
  inspectPowerShellStatus,
  inspectTaskManagerStatus,
  previewSystemUtilityPolicy,
  revertSystemUtilityPolicy,
  scanSystemUtilityViolations,
} from '../systemUtility'

describe('Phase 2B: System Utility Restrictions IPC Bridge', () => {
  it('retrieves system utility inventory with standard Windows utilities', async () => {
    const catalog = await getSystemUtilityInventory()
    expect(catalog).toBeDefined()
    expect(Array.isArray(catalog)).toBe(true)
    expect(catalog.length).toBeGreaterThan(0)

    const powershell = catalog.find((i) => i.executableName === 'powershell.exe')
    expect(powershell).toBeDefined()
    expect(powershell?.category).toBe('CommandAndScripting')

    const taskmgr = catalog.find((i) => i.executableName === 'taskmgr.exe')
    expect(taskmgr).toBeDefined()
    expect(taskmgr?.category).toBe('ProcessAndTaskManagement')

    const explorer = catalog.find((i) => i.executableName === 'explorer.exe')
    expect(explorer).toBeDefined()
    expect(explorer?.isCriticalProtected).toBe(true)
  })

  it('inspects PowerShell status report', async () => {
    const report = await inspectPowerShellStatus()
    expect(report).toBeDefined()
    expect(typeof report.winPowershellInstalled).toBe('boolean')
    expect(report.activeMode).toBeDefined()
    expect(report.currentState).toBeDefined()
  })

  it('applies and inspects PowerShell restriction mode', async () => {
    const updated = await applyPowerShellPolicy('Restrict')
    expect(updated).toBeDefined()
    expect(updated.activeMode).toBe('Restrict')
    expect(updated.currentState).toBe('Restricted')
  })

  it('inspects and applies Command Prompt (cmd.exe) policy', async () => {
    const report = await inspectCmdStatus()
    expect(report).toBeDefined()
    expect(typeof report.isInstalled).toBe('boolean')

    const applied = await applyCmdPolicy('Block')
    expect(applied).toBeDefined()
    expect(applied.activeMode).toBe('Block')
    expect(applied.currentState).toBe('BlockedByPolicy')
    expect(applied.disableCmdRegistryValue).toBe(2)
  })

  it('inspects and applies Task Manager policy', async () => {
    const report = await inspectTaskManagerStatus()
    expect(report).toBeDefined()
    expect(typeof report.isInstalled).toBe('boolean')

    const applied = await applyTaskManagerPolicy('Block')
    expect(applied).toBeDefined()
    expect(applied.activeMode).toBe('Block')
    expect(applied.currentState).toBe('BlockedByPolicy')
    expect(applied.disableTaskmgrRegistryValue).toBe(1)
  })

  it('previews and applies centralized utility policy lifecycle', async () => {
    const current = await getSystemUtilityPolicy()
    expect(current).toBeDefined()
    expect(current.powershellMode).toBeDefined()

    const preview = await previewSystemUtilityPolicy(current)
    expect(preview).toBeDefined()
    expect(typeof preview.isValid).toBe('boolean')

    const applied = await applySystemUtilityPolicy(current, true)
    expect(applied).toBeDefined()
    expect(applied.adminApproved).toBe(true)
    expect(applied.state).toBe('Active')
  })

  it('scans running utilities and handles baseline revert', async () => {
    const scan = await scanSystemUtilityViolations()
    expect(scan).toBeDefined()
    expect(typeof scan.totalProcessesChecked).toBe('number')
    expect(Array.isArray(scan.violations)).toBe(true)

    const reverted = await revertSystemUtilityPolicy()
    expect(reverted).toBeDefined()
    expect(reverted.powershellMode).toBe('DetectionOnly')
    expect(reverted.cmdMode).toBe('DetectionOnly')
    expect(reverted.taskManagerMode).toBe('DetectionOnly')
  })
})

