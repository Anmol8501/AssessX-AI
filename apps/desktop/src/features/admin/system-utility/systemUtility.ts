/**
 * Phase 2B: System Utility Restrictions IPC Bridge.
 *
 * Exposes narrow, typed IPC commands to interact with System Utility Inventory,
 * PowerShell, Command Prompt, Task Manager, Policy Lifecycle, and Violation Scanning.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'
import type {
  CmdRestrictionMode,
  CmdStatusReport,
  PowerShellRestrictionMode,
  PowerShellStatusReport,
  SystemUtilityItem,
  SystemUtilityPolicyConfig,
  SystemUtilityScanSummary,
  TaskManagerRestrictionMode,
  TaskManagerStatusReport,
  UtilityPolicyPreview,
} from './types'

export function isTauriEnvironment(): boolean {
  return isTauri()
}

/** Query system utility inventory. */
export function getSystemUtilityInventory(): Promise<SystemUtilityItem[]> {
  if (!isTauri()) {
    return Promise.resolve([
      {
        utilityId: 'util-win-powershell',
        displayName: 'Windows PowerShell',
        executableName: 'powershell.exe',
        knownPaths: ['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
        resolvedPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        category: 'CommandAndScripting',
        publisher: 'Microsoft Corporation',
        fileHash: 'a1b2c3d4e5f6',
        defaultAction: 'Block',
        criticality: 'HighRisk',
        isCriticalProtected: false,
        isInstalled: true,
      },
      {
        utilityId: 'util-cmd',
        displayName: 'Windows Command Prompt',
        executableName: 'cmd.exe',
        knownPaths: ['C:\\Windows\\System32\\cmd.exe'],
        resolvedPath: 'C:\\Windows\\System32\\cmd.exe',
        category: 'CommandAndScripting',
        publisher: 'Microsoft Corporation',
        fileHash: 'b2c3d4e5f6a1',
        defaultAction: 'Block',
        criticality: 'HighRisk',
        isCriticalProtected: false,
        isInstalled: true,
      },
      {
        utilityId: 'util-taskmgr',
        displayName: 'Windows Task Manager',
        executableName: 'taskmgr.exe',
        knownPaths: ['C:\\Windows\\System32\\taskmgr.exe'],
        resolvedPath: 'C:\\Windows\\System32\\taskmgr.exe',
        category: 'ProcessAndTaskManagement',
        publisher: 'Microsoft Corporation',
        fileHash: 'c3d4e5f6a1b2',
        defaultAction: 'Block',
        criticality: 'HighRisk',
        isCriticalProtected: false,
        isInstalled: true,
      },
      {
        utilityId: 'util-explorer',
        displayName: 'Windows Explorer (Shell)',
        executableName: 'explorer.exe',
        knownPaths: ['C:\\Windows\\explorer.exe'],
        resolvedPath: 'C:\\Windows\\explorer.exe',
        category: 'FileAndNavigation',
        publisher: 'Microsoft Corporation',
        fileHash: 'd4e5f6a1b2c3',
        defaultAction: 'Allow',
        criticality: 'CriticalProtected',
        isCriticalProtected: true,
        isInstalled: true,
      },
    ])
  }
  return invoke<SystemUtilityItem[]>('get_system_utility_inventory')
}

/** Inspect PowerShell availability and restriction status. */
export function inspectPowerShellStatus(): Promise<PowerShellStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      winPowershellInstalled: true,
      winPowershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      winPowershellVersion: '5.1.22621.1',
      winPowershellHash: 'a1b2c3d4e5f6',
      pwsh7Installed: false,
      pwsh7Path: null,
      pwsh7Version: null,
      pwsh7Hash: null,
      activeMode: 'DetectionOnly',
      currentState: 'Available',
      runningInstancesCount: 0,
      candidateAccountScoped: true,
      lastVerifiedAt: '1731000000',
    })
  }
  return invoke<PowerShellStatusReport>('inspect_powershell_status')
}

/** Apply a PowerShell restriction policy. */
export function applyPowerShellPolicy(
  mode: PowerShellRestrictionMode,
  candidateSid?: string,
): Promise<PowerShellStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      winPowershellInstalled: true,
      winPowershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      winPowershellVersion: '5.1.22621.1',
      winPowershellHash: 'a1b2c3d4e5f6',
      pwsh7Installed: false,
      pwsh7Path: null,
      pwsh7Version: null,
      pwsh7Hash: null,
      activeMode: mode,
      currentState: mode === 'Block' ? 'BlockedByPolicy' : mode === 'Restrict' ? 'Restricted' : 'Available',
      runningInstancesCount: 0,
      candidateAccountScoped: true,
      lastVerifiedAt: '1731000000',
    })
  }
  return invoke<PowerShellStatusReport>('apply_powershell_policy', {
    mode,
    candidateSid: candidateSid ?? null,
  })
}

/** Inspect Command Prompt availability and restriction status. */
export function inspectCmdStatus(candidateSid?: string): Promise<CmdStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      isInstalled: true,
      primaryPath: 'C:\\Windows\\System32\\cmd.exe',
      fileHash: 'b2c3d4e5f6a1',
      fileVersion: '10.0.22621.1',
      activeMode: 'DetectionOnly',
      currentState: 'Available',
      disableCmdRegistryValue: null,
      runningInstancesCount: 0,
      candidateAccountScoped: false,
      lastVerifiedAt: '1731000000',
    })
  }
  return invoke<CmdStatusReport>('inspect_cmd_status', {
    candidateSid: candidateSid ?? null,
  })
}

/** Apply a Command Prompt restriction policy. */
export function applyCmdPolicy(
  mode: CmdRestrictionMode,
  candidateSid?: string,
): Promise<CmdStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      isInstalled: true,
      primaryPath: 'C:\\Windows\\System32\\cmd.exe',
      fileHash: 'b2c3d4e5f6a1',
      fileVersion: '10.0.22621.1',
      activeMode: mode,
      currentState: mode === 'Block' ? 'BlockedByPolicy' : mode === 'Restrict' ? 'Restricted' : 'Available',
      disableCmdRegistryValue: mode === 'Block' ? 2 : mode === 'Restrict' ? 1 : null,
      runningInstancesCount: 0,
      candidateAccountScoped: false,
      lastVerifiedAt: '1731000000',
    })
  }
  return invoke<CmdStatusReport>('apply_cmd_policy', {
    mode,
    candidateSid: candidateSid ?? null,
  })
}

/** Inspect Task Manager availability and restriction status. */
export function inspectTaskManagerStatus(candidateSid?: string): Promise<TaskManagerStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      isInstalled: true,
      primaryPath: 'C:\\Windows\\System32\\taskmgr.exe',
      fileHash: 'c3d4e5f6a1b2',
      fileVersion: '10.0.22621.1',
      activeMode: 'DetectionOnly',
      currentState: 'Available',
      disableTaskmgrRegistryValue: null,
      runningInstancesCount: 0,
      candidateAccountScoped: false,
      lastVerifiedAt: '1731000000',
    })
  }
  return invoke<TaskManagerStatusReport>('inspect_task_manager_status', {
    candidateSid: candidateSid ?? null,
  })
}

/** Apply a Task Manager restriction policy. */
export function applyTaskManagerPolicy(
  mode: TaskManagerRestrictionMode,
  candidateSid?: string,
): Promise<TaskManagerStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      isInstalled: true,
      primaryPath: 'C:\\Windows\\System32\\taskmgr.exe',
      fileHash: 'c3d4e5f6a1b2',
      fileVersion: '10.0.22621.1',
      activeMode: mode,
      currentState: mode === 'Block' ? 'BlockedByPolicy' : 'Available',
      disableTaskmgrRegistryValue: mode === 'Block' ? 1 : null,
      runningInstancesCount: 0,
      candidateAccountScoped: false,
      lastVerifiedAt: '1731000000',
    })
  }
  return invoke<TaskManagerStatusReport>('apply_task_manager_policy', {
    mode,
    candidateSid: candidateSid ?? null,
  })
}

/** Get the currently configured system utility policy. */
export function getSystemUtilityPolicy(): Promise<SystemUtilityPolicyConfig> {
  if (!isTauri()) {
    return Promise.resolve({
      id: 'default-system-utility-policy',
      version: 1,
      powershellMode: 'DetectionOnly',
      cmdMode: 'DetectionOnly',
      taskManagerMode: 'DetectionOnly',
      registryToolsBlocked: false,
      utilityRules: [],
      candidateAccount: 'AssessXCandidate',
      candidateSid: null,
      state: 'Active',
      adminApproved: true,
      updatedAt: '1731000000',
    })
  }
  return invoke<SystemUtilityPolicyConfig>('get_system_utility_policy')
}

/** Preview validation results and potential conflicts for a proposed utility policy. */
export function previewSystemUtilityPolicy(
  policy: SystemUtilityPolicyConfig,
): Promise<UtilityPolicyPreview> {
  if (!isTauri()) {
    return Promise.resolve({
      totalRules: policy.utilityRules.length,
      blockedUtilitiesCount: 0,
      restrictedUtilitiesCount: 0,
      conflicts: [],
      isValid: true,
      affectedRegistryKeys: [],
      safetySummary: 'Policy preview valid in browser fallback mode.',
    })
  }
  return invoke<UtilityPolicyPreview>('preview_system_utility_policy', { policy })
}

/** Apply a validated utility policy with administrator approval. */
export function applySystemUtilityPolicy(
  policy: SystemUtilityPolicyConfig,
  adminApproved: boolean,
): Promise<SystemUtilityPolicyConfig> {
  if (!isTauri()) {
    return Promise.resolve({
      ...policy,
      state: adminApproved ? 'Active' : 'ApprovalDenied',
      adminApproved,
      updatedAt: '1731000000',
    })
  }
  return invoke<SystemUtilityPolicyConfig>('apply_system_utility_policy', {
    policy,
    adminApproved,
  })
}

/** Scan active processes for system utility violations. */
export function scanSystemUtilityViolations(): Promise<SystemUtilityScanSummary> {
  if (!isTauri()) {
    return Promise.resolve({
      totalProcessesChecked: 120,
      violationsCount: 0,
      hasViolations: false,
      violations: [],
    })
  }
  return invoke<SystemUtilityScanSummary>('scan_system_utility_violations')
}

/** Revert all system utility policies back to default detection-only baseline. */
export function revertSystemUtilityPolicy(): Promise<SystemUtilityPolicyConfig> {
  if (!isTauri()) {
    return Promise.resolve({
      id: 'default-system-utility-policy',
      version: 1,
      powershellMode: 'DetectionOnly',
      cmdMode: 'DetectionOnly',
      taskManagerMode: 'DetectionOnly',
      registryToolsBlocked: false,
      utilityRules: [],
      candidateAccount: 'AssessXCandidate',
      candidateSid: null,
      state: 'Active',
      adminApproved: true,
      updatedAt: '1731000000',
    })
  }
  return invoke<SystemUtilityPolicyConfig>('revert_system_utility_policy')
}

