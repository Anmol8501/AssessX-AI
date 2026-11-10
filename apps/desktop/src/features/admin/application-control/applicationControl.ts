/**
 * Phase 2A: Application Allowlisting & Execution Control IPC Bridge.
 *
 * Exposes narrow, typed IPC commands to interact with Application Inventory,
 * Allowlist Rules, Windows Enforcement Capabilities (WDAC / AppLocker),
 * Policy Lifecycle, and Violation Detection.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'
import type {
  AllowlistCategory,
  AllowlistEntry,
  ApplicationIdentity,
  ApplicationScanSummary,
  EnforcementCapabilityReport,
  PolicyEngineState,
  PolicyMode,
  PolicyOperationResult,
  PolicyPreview,
  RuleAction,
  RuleType,
} from './types'

export function isTauriEnvironment(): boolean {
  return isTauri()
}

/** Query running application inventory on host. */
export function getApplicationInventory(): Promise<ApplicationIdentity[]> {
  if (!isTauri()) {
    return Promise.resolve([
      {
        applicationId: 'assessx',
        displayName: 'AssessX Secure Examination Client',
        executableName: 'AssessX.exe',
        executablePath: 'C:\\Program Files\\AssessX\\AssessX.exe',
        publisher: 'AssessX Inc.',
        fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        fileVersion: '0.1.5',
        signatureStatus: 'SignedTrusted',
        isRunning: true,
        processIds: [1234],
        verifiedAt: '1731000000',
      },
      {
        applicationId: 'explorer',
        displayName: 'Windows Explorer',
        executableName: 'explorer.exe',
        executablePath: 'C:\\Windows\\explorer.exe',
        publisher: 'Microsoft Windows',
        fileHash: 'c4ca4238a0b923820dcc509a6f75849b27ae41e4649b934ca495991b7852b866',
        fileVersion: '10.0.22631.1',
        signatureStatus: 'SignedTrusted',
        isRunning: true,
        processIds: [4567],
        verifiedAt: '1731000000',
      },
    ])
  }
  return invoke<ApplicationIdentity[]>('application_control_get_inventory')
}

/** Retrieve all allowlist rules. */
export function getApplicationAllowlist(): Promise<AllowlistEntry[]> {
  if (!isTauri()) {
    return Promise.resolve([
      {
        id: 'baseline-assessx-core',
        name: 'AssessX Core Desktop Client',
        category: 'CoreAssessX',
        ruleType: 'ExecutableName',
        ruleValue: 'AssessX.exe',
        action: 'Allow',
        reason: 'Primary examination platform runtime',
        isSystemRule: true,
        createdAt: '0',
      },
      {
        id: 'baseline-win-explorer',
        name: 'Windows Explorer Shell',
        category: 'WindowsSystem',
        ruleType: 'ExecutableName',
        ruleValue: 'explorer.exe',
        action: 'Allow',
        reason: 'Required Windows user session shell',
        isSystemRule: true,
        createdAt: '0',
      },
      {
        id: 'baseline-blocked-chrome',
        name: 'Google Chrome Browser',
        category: 'BlockedApplication',
        ruleType: 'ExecutableName',
        ruleValue: 'chrome.exe',
        action: 'Deny',
        reason: 'External browser prohibited during exam',
        isSystemRule: true,
        createdAt: '0',
      },
    ])
  }
  return invoke<AllowlistEntry[]>('application_control_get_allowlist')
}

/** Add an administrator-authorized allowlist rule. */
export function addAllowlistRule(
  name: string,
  category: AllowlistCategory,
  ruleType: RuleType,
  ruleValue: string,
  action: RuleAction,
  reason: string
): Promise<AllowlistEntry> {
  if (!isTauri()) {
    return Promise.resolve({
      id: `custom-rule-${Date.now()}`,
      name,
      category,
      ruleType,
      ruleValue,
      action,
      reason,
      isSystemRule: false,
      createdAt: Date.now().toString(),
    })
  }
  return invoke<AllowlistEntry>('application_control_add_rule', {
    name,
    category,
    ruleType,
    ruleValue,
    action,
    reason,
  })
}

/** Remove an allowlist rule. */
export function removeAllowlistRule(ruleId: string): Promise<boolean> {
  if (!isTauri()) {
    return Promise.resolve(true)
  }
  return invoke<boolean>('application_control_remove_rule', { ruleId })
}

/** Detect Windows application control capabilities. */
export function getEnforcementCapabilities(): Promise<EnforcementCapabilityReport> {
  if (!isTauri()) {
    return Promise.resolve({
      primaryMechanism: 'Wdac',
      status: 'PartiallySupported',
      windowsEdition: 'Windows 11 Pro',
      windowsBuild: '22631',
      wdacSupported: true,
      applockerSupported: false,
      appidsvcRunning: true,
      processSupervisionActive: true,
      isEnforcementCapable: true,
      summary: 'Windows Pro supports App Control for Business (WDAC) and Security Agent Process Supervision.',
      recommendations: [
        'Windows Pro supports WDAC policies. For hardware-enforced AppLocker, Enterprise edition is recommended.',
      ],
    })
  }
  return invoke<EnforcementCapabilityReport>('application_control_get_capabilities')
}

/** Query active policy state. */
export function getPolicyState(): Promise<PolicyEngineState> {
  if (!isTauri()) {
    return Promise.resolve({
      policyId: 'default-app-policy-v1',
      version: 1,
      mode: 'AuditMode',
      state: 'Active',
      lastUpdated: Date.now().toString(),
    })
  }
  return invoke<PolicyEngineState>('application_control_get_policy_state')
}

/** Preview application control policy. */
export function previewApplicationPolicy(mode: PolicyMode): Promise<PolicyPreview> {
  if (!isTauri()) {
    return Promise.resolve({
      policyId: 'default-app-policy-v1',
      policyVersion: 1,
      mode,
      currentState: 'Validated',
      totalRules: 10,
      allowedCount: 6,
      deniedCount: 4,
      plannedActions: ['Configure policy in AuditMode', 'Activate process supervision'],
      rollbackActions: ['Restore baseline', 'Revert to Draft'],
      isSafeToApply: true,
      validationErrors: [],
    })
  }
  return invoke<PolicyPreview>('application_control_preview_policy', { mode })
}

/** Apply application policy with explicit admin approval. */
export function applyApplicationPolicy(
  mode: PolicyMode,
  adminApproved: boolean
): Promise<PolicyOperationResult> {
  if (!isTauri()) {
    return Promise.resolve({
      success: adminApproved,
      currentState: adminApproved ? 'Active' : 'AwaitingAdminApproval',
      message: adminApproved
        ? `Application control policy active in ${mode}.`
        : 'Admin approval required.',
      timestamp: Date.now().toString(),
    })
  }
  return invoke<PolicyOperationResult>('application_control_apply_policy', {
    mode,
    adminApproved,
  })
}

/** Restore application policy baseline. */
export function restoreApplicationPolicyBaseline(): Promise<PolicyOperationResult> {
  if (!isTauri()) {
    return Promise.resolve({
      success: true,
      currentState: 'Draft',
      message: 'Restored baseline policy draft.',
      timestamp: Date.now().toString(),
    })
  }
  return invoke<PolicyOperationResult>('application_control_restore_baseline')
}

/** Scan running applications for policy violations. */
export function scanApplicationViolations(): Promise<ApplicationScanSummary> {
  if (!isTauri()) {
    return Promise.resolve({
      totalScanned: 2,
      approvedCount: 2,
      deniedCount: 0,
      unapprovedCount: 0,
      hasViolations: false,
      violations: [],
    })
  }
  return invoke<ApplicationScanSummary>('application_control_scan_violations')
}

