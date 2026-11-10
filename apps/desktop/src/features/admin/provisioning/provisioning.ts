/**
 * Phase 1A: Windows Environment & Device Provisioning Bridge.
 *
 * Exposes narrow, typed IPC commands to invoke native Windows compatibility,
 * hardware inspection, security readiness, administrator elevation checks,
 * candidate account inspection, cryptographic device identity, validation, and diagnostics.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'
import type {
  CandidateAccountStatus,
  ChangeJournal,
  ConfigurationValidationReport,
  DeviceIdentity,
  FullDeviceReadinessScan,
  HardwareReadinessReport,
  InstallationDiagnosticReport,
  PrivilegeStatusReport,
  ProvisioningPlan,
  WindowsCompatibilityReport,
  WindowsSecurityReport,
} from './types'

export function isTauriEnvironment(): boolean {
  return isTauri()
}

/** Check Windows OS edition, build number, and kiosk support (Module 1). */
export function getWindowsCompatibility(): Promise<WindowsCompatibilityReport> {
  if (!isTauri()) {
    return Promise.resolve({
      platform: 'browser',
      edition: 'Web Browser Environment',
      displayVersion: 'Development',
      buildNumber: '0',
      ubr: 0,
      architecture: 'x64',
      compatibility: 'WARNING',
      kioskSupported: false,
      summary: 'Running in browser. Native Windows APIs are available inside the packaged desktop application.',
      warnings: ['Native Windows registry queries are bypassed in browser dev mode.'],
    })
  }
  return invoke<WindowsCompatibilityReport>('provisioning_get_compatibility')
}

/** Scan CPU, RAM, storage, and display readiness (Module 2). */
export function getHardwareReadiness(): Promise<HardwareReadinessReport> {
  if (!isTauri()) {
    return Promise.resolve({
      cpu: {
        model: 'Web Environment Processor',
        logicalCores: 8,
        status: 'PASS',
        message: 'Browser simulated hardware check.',
      },
      memory: {
        totalGb: 16.0,
        availableGb: 8.0,
        percentUsed: 50,
        status: 'PASS',
        message: 'Browser simulated RAM.',
      },
      storage: {
        systemDrive: 'C:\\',
        totalGb: 512.0,
        freeGb: 250.0,
        status: 'PASS',
        message: 'Browser simulated disk space.',
      },
      display: {
        monitorCount: 1,
        primaryResolution: '1920x1080',
        status: 'PASS',
        message: '1 display detected.',
      },
      overallStatus: 'PASS',
      summary: 'Simulated hardware check for browser environment.',
    })
  }
  return invoke<HardwareReadinessReport>('provisioning_get_hardware')
}

/** Check Secure Boot, TPM, Windows Firewall, and Antivirus protection (Module 3). */
export function getWindowsSecurity(): Promise<WindowsSecurityReport> {
  if (!isTauri()) {
    return Promise.resolve({
      secureBoot: {
        name: 'Secure Boot',
        status: 'PASS',
        value: 'Simulated Active',
        details: 'Simulated in browser dev mode.',
      },
      tpm: {
        name: 'TPM 2.0 / Security Hardware',
        status: 'PASS',
        value: 'Simulated Available',
        details: 'Simulated in browser dev mode.',
      },
      firewall: {
        name: 'Windows Firewall',
        status: 'PASS',
        value: 'Simulated Active',
        details: 'Simulated in browser dev mode.',
      },
      antivirus: {
        name: 'Antivirus & Protection',
        status: 'PASS',
        value: 'Active',
        details: 'Simulated in browser dev mode.',
      },
      overallStatus: 'PASS',
      summary: 'Browser dev mode simulated security checks.',
    })
  }
  return invoke<WindowsSecurityReport>('provisioning_get_security')
}

/** Verify current process elevation and administrative context (Module 4). */
export function getPrivilegeStatus(): Promise<PrivilegeStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      isElevated: false,
      userName: 'Administrator',
      privilegeLevel: 'STANDARD_USER',
      canProvisionKiosk: false,
      summary: 'Running in browser dev mode as standard user.',
    })
  }
  return invoke<PrivilegeStatusReport>('provisioning_get_privileges')
}

/** Retrieve or initialize persistent cryptographic AssessX Device Identity (Module 6). */
export function getDeviceIdentity(): Promise<DeviceIdentity> {
  if (!isTauri()) {
    return Promise.resolve({
      deviceId: 'browser-simulated-device-id-0000-000000000001',
      createdAt: new Date().toISOString(),
      hostname: 'BROWSER-DEV',
      platform: 'browser',
      isRegistered: false,
      registrationToken: null,
    })
  }
  return invoke<DeviceIdentity>('provisioning_get_device_identity')
}

/** Re-enroll device identity with fresh cryptographic thumbprint (Module 6). */
export function reEnrollDeviceIdentity(): Promise<DeviceIdentity> {
  if (!isTauri()) {
    return Promise.resolve({
      deviceId: `browser-re-enrolled-${Date.now()}`,
      createdAt: new Date().toISOString(),
      hostname: 'BROWSER-DEV',
      platform: 'browser',
      isRegistered: false,
      registrationToken: null,
    })
  }
  return invoke<DeviceIdentity>('provisioning_re_enroll_device_identity')
}

/** Inspect local candidate account status (Module 5). */
export function inspectCandidateAccount(accountName = 'AssessXCandidate'): Promise<CandidateAccountStatus> {
  if (!isTauri()) {
    return Promise.resolve({
      accountName,
      exists: false,
      isStandardUser: false,
      isAdministrator: false,
      status: 'NOT_FOUND',
      message: 'Account inspection simulated in browser.',
    })
  }
  return invoke<CandidateAccountStatus>('provisioning_inspect_account', { accountName })
}

/** Generate a non-destructive candidate account provisioning plan (Module 5). */
export function getProvisioningPlan(
  accountName = 'AssessXCandidate',
  appPath = 'C:\\Program Files\\AssessX\\AssessX.exe'
): Promise<ProvisioningPlan> {
  if (!isTauri()) {
    return Promise.resolve({
      targetAccount: accountName,
      currentStatus: {
        accountName,
        exists: false,
        isStandardUser: false,
        isAdministrator: false,
        status: 'NOT_FOUND',
        message: 'Account simulated in browser.',
      },
      recommendedAction: 'Create dedicated standard candidate account',
      steps: [
        {
          stepNumber: 1,
          title: 'Verify elevation',
          description: 'Ensure process has Administrator rights.',
          command: null,
          requiresElevation: true,
          isReversible: true,
        },
      ],
      requiresAdminApproval: true,
      generatedAt: new Date().toISOString(),
    })
  }
  return invoke<ProvisioningPlan>('provisioning_get_plan', { accountName, appPath })
}

/** Validate local application binary and data directory permissions (Module 8). */
export function validateConfiguration(): Promise<ConfigurationValidationReport> {
  if (!isTauri()) {
    return Promise.resolve({
      checks: [
        {
          name: 'Application Binary Integrity',
          status: 'PASS',
          details: 'Browser dev environment.',
        },
        {
          name: 'Data Directory Write Permissions',
          status: 'PASS',
          details: 'Browser local storage access confirmed.',
        },
      ],
      overallStatus: 'READY',
      summary: 'All configuration checks passed.',
    })
  }
  return invoke<ConfigurationValidationReport>('provisioning_validate_configuration')
}

/** Generate comprehensive scrubbed diagnostic report (Module 9). */
export function getDiagnosticReport(candidateAccountName = 'AssessXCandidate'): Promise<InstallationDiagnosticReport> {
  if (!isTauri()) {
    return Promise.all([
      getDeviceIdentity(),
      getWindowsCompatibility(),
      getHardwareReadiness(),
      getWindowsSecurity(),
      inspectCandidateAccount(candidateAccountName),
      validateConfiguration(),
    ]).then(([deviceIdentity, compatibility, hardware, security, account, validation]) => ({
      diagnosticId: `diag-browser-${Date.now()}`,
      timestamp: new Date().toISOString(),
      deviceIdentity,
      compatibility,
      hardware,
      security,
      account,
      validation,
      overallStatus: 'PASS' as const,
      summary: 'Browser diagnostic report preview.',
      warnings: [],
      failures: [],
    }))
  }
  return invoke<InstallationDiagnosticReport>('provisioning_get_diagnostic_report', { candidateAccountName })
}

/** Retrieve change journal history (Module 10). */
export function getChangeJournal(): Promise<ChangeJournal> {
  if (!isTauri()) {
    return Promise.resolve({
      entries: [],
    })
  }
  return invoke<ChangeJournal>('provisioning_get_journal')
}

/** Execute a unified, parallel scan across all Stage 1 readiness modules. */
export function runFullDeviceScan(): Promise<FullDeviceReadinessScan> {
  if (!isTauri()) {
    return Promise.all([
      getWindowsCompatibility(),
      getHardwareReadiness(),
      getWindowsSecurity(),
      getPrivilegeStatus(),
      getDeviceIdentity(),
    ]).then(([compatibility, hardware, security, privileges, identity]) => ({
      compatibility,
      hardware,
      security,
      privileges,
      identity,
      overallReadiness: 'READY_WITH_WARNINGS',
      timestamp: new Date().toISOString(),
    }))
  }
  return invoke<FullDeviceReadinessScan>('provisioning_run_full_scan')
}
