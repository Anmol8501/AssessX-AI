/**
 * Phase 1B: Secure Shell & Examination Startup IPC Bridge.
 *
 * Exposes narrow, typed IPC commands to interact with Windows Kiosk capabilities,
 * automatic startup registration, display topology, examination startup validation,
 * crash recovery, and administrator-authorized normal-mode restoration.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'
import type {
  CrashRecoveryReport,
  DisplayTopologyReport,
  ExaminationStartupValidationReport,
  KioskCapabilityReport,
  KioskConfigPreview,
  KioskOperationResult,
  RestorationOperationResult,
  RestorationPreview,
  ShellHealthReport,
  StartupConfigurationReport,
  StartupOperationResult,
} from './types'

export function isTauriEnvironment(): boolean {
  return isTauri()
}

/** Detect Windows Assigned Access and Shell Launcher capabilities (Stage 1). */
export function getKioskCapabilities(): Promise<KioskCapabilityReport> {
  if (!isTauri()) {
    return Promise.resolve({
      windowsCompatibility: {
        platform: 'browser',
        edition: 'Web Development Environment',
        displayVersion: 'Development',
        buildNumber: '0',
        ubr: 0,
        architecture: 'x64',
        compatibility: 'WARNING',
        kioskSupported: false,
        summary: 'Running in browser. Native Windows kiosk capabilities are available inside the packaged desktop application.',
        warnings: ['Native Windows registry queries bypassed in browser.'],
      },
      assignedAccess: {
        mechanismName: 'Windows Assigned Access',
        isSupported: true,
        isConfigured: false,
        status: 'SUPPORTED',
        missingFeatures: [],
        requiredPermissions: 'Administrator privileges required.',
        details: 'Simulated Assigned Access capability.',
      },
      shellLauncher: {
        mechanismName: 'Windows Shell Launcher',
        isSupported: false,
        isConfigured: false,
        status: 'UNSUPPORTED_EDITION',
        missingFeatures: ['Enterprise edition required'],
        requiredPermissions: 'Administrator privileges required.',
        details: 'Simulated Shell Launcher capability.',
      },
      recommendedMechanism: 'ASSIGNED_ACCESS',
      overallStatus: 'SUPPORTED',
      limitations: [],
      summary: 'Windows Assigned Access is recommended for this simulated device.',
    })
  }
  return invoke<KioskCapabilityReport>('secure_shell_get_kiosk_capabilities')
}

/** Preview kiosk configuration changes before application (Stage 2). */
export function previewKioskConfig(
  targetAccount = 'AssessXCandidate',
  mechanism = 'ASSIGNED_ACCESS',
  executablePath = 'C:\\Program Files\\AssessX\\AssessX.exe'
): Promise<KioskConfigPreview> {
  if (!isTauri()) {
    return Promise.resolve({
      targetAccount,
      mechanism,
      executablePath,
      requiresElevation: true,
      isSupported: true,
      plannedSteps: [
        '1. Verify administrative privileges on current Windows host.',
        '2. Pre-record original Windows shell configuration in Change Journal.',
        `3. Configure ${mechanism} for candidate account '${targetAccount}'.`,
        `4. Set application binary path to '${executablePath}'.`,
        '5. Verify registry and WMI acceptance of new shell configuration.',
      ],
      rollbackSteps: [
        `1. Revert ${mechanism} configuration for account '${targetAccount}'.`,
        '2. Restore default Windows explorer.exe shell.',
        '3. Log restoration outcome in Change Journal.',
      ],
      warning: 'Configuration will only modify the dedicated candidate account.',
    })
  }
  return invoke<KioskConfigPreview>('secure_shell_preview_kiosk_config', {
    targetAccount,
    mechanism,
    executablePath,
  })
}

/** Apply Windows kiosk configuration with explicit administrator approval (Stage 2). */
export function applyKioskConfig(
  targetAccount = 'AssessXCandidate',
  mechanism = 'ASSIGNED_ACCESS',
  executablePath = 'C:\\Program Files\\AssessX\\AssessX.exe',
  adminApproved = false
): Promise<KioskOperationResult> {
  if (!isTauri()) {
    if (!adminApproved) {
      return Promise.resolve({
        success: false,
        currentState: 'ADMIN_APPROVAL_REQUIRED',
        message: 'Explicit administrator approval was not provided.',
        journalEntryId: null,
      })
    }
    return Promise.resolve({
      success: true,
      currentState: 'CONFIGURED',
      message: `Simulated kiosk mode (${mechanism}) configured for '${targetAccount}'.`,
      journalEntryId: 'JRN-SIMULATED-001',
    })
  }
  return invoke<KioskOperationResult>('secure_shell_apply_kiosk_config', {
    targetAccount,
    mechanism,
    executablePath,
    adminApproved,
  })
}

/** Inspect automatic examination startup status (Stage 3). */
export function inspectStartup(targetAccount = 'AssessXCandidate'): Promise<StartupConfigurationReport> {
  if (!isTauri()) {
    return Promise.resolve({
      isConfigured: false,
      targetAccount,
      executablePath: 'C:\\Program Files\\AssessX\\AssessX.exe',
      startupMechanism: 'NOT_CONFIGURED',
      status: 'NOT_CONFIGURED',
      executableExists: true,
      accountExists: false,
      details: 'Startup inspection simulated in browser.',
      warnings: [],
    })
  }
  return invoke<StartupConfigurationReport>('secure_shell_inspect_startup', { targetAccount })
}

/** Register or unregister automatic startup for the candidate account (Stage 3). */
export function registerStartup(targetAccount = 'AssessXCandidate', enable = true): Promise<StartupOperationResult> {
  if (!isTauri()) {
    return Promise.resolve({
      success: true,
      status: enable ? 'CONFIGURED' : 'NOT_CONFIGURED',
      message: `Automatic startup ${enable ? 'registered' : 'removed'} for '${targetAccount}' (simulated).`,
      journalEntryId: 'JRN-SIMULATED-STARTUP',
    })
  }
  return invoke<StartupOperationResult>('secure_shell_register_startup', { targetAccount, enable })
}

/** Inspect display topology and fullscreen state (Stage 4). */
export function getDisplayTopology(): Promise<DisplayTopologyReport> {
  if (!isTauri()) {
    return Promise.resolve({
      monitorCount: 1,
      primaryDisplay: {
        displayId: 'display-1',
        name: 'Primary Display (Simulated)',
        width: 1920,
        height: 1080,
        scaleFactor: 1.0,
        isPrimary: true,
      },
      displays: [
        {
          displayId: 'display-1',
          name: 'Primary Display (Simulated)',
          width: 1920,
          height: 1080,
          scaleFactor: 1.0,
          isPrimary: true,
        },
      ],
      isMultiMonitor: false,
      isFullscreen: false,
      isFocused: true,
      status: 'NOT_FULLSCREEN',
      message: 'Running in browser window.',
    })
  }
  return invoke<DisplayTopologyReport>('secure_shell_get_display_topology')
}

/** Enforce exclusive fullscreen window mode (Stage 4). */
export function enforceFullscreen(): Promise<boolean> {
  if (!isTauri()) {
    return Promise.resolve(true)
  }
  return invoke<boolean>('secure_shell_enforce_fullscreen')
}

/** Release exclusive fullscreen window mode (Stage 4). */
export function releaseFullscreen(): Promise<boolean> {
  if (!isTauri()) {
    return Promise.resolve(true)
  }
  return invoke<boolean>('secure_shell_release_fullscreen')
}

/** Retrieve current examination session lifecycle state (Stage 5). */
export function getLifecycleState(): Promise<string> {
  if (!isTauri()) {
    return Promise.resolve('NORMAL_MODE')
  }
  return invoke<string>('secure_shell_get_lifecycle_state')
}

/** Run comprehensive pre-flight examination startup validation (Stage 5). */
export function runStartupValidation(candidateAccountName = 'AssessXCandidate'): Promise<ExaminationStartupValidationReport> {
  if (!isTauri()) {
    return Promise.resolve({
      overallResult: 'READY_WITH_WARNINGS',
      checks: [
        {
          name: 'Application Binary Integrity',
          status: 'PASS',
          explanation: 'Executable integrity verified.',
          severity: 'INFO',
          blocksStartup: false,
          resolution: 'None required.',
        },
        {
          name: 'Device Registration',
          status: 'PASS',
          explanation: 'Device Identity active.',
          severity: 'INFO',
          blocksStartup: false,
          resolution: 'None required.',
        },
        {
          name: 'Candidate Account Isolation',
          status: 'PASS',
          explanation: 'Standard user isolation confirmed.',
          severity: 'INFO',
          blocksStartup: false,
          resolution: 'None required.',
        },
        {
          name: 'Windows Kiosk Environment',
          status: 'PASS',
          explanation: 'Kiosk capabilities ready.',
          severity: 'INFO',
          blocksStartup: false,
          resolution: 'None required.',
        },
        {
          name: 'Hardware Readiness',
          status: 'PASS',
          explanation: 'Hardware resources pass.',
          severity: 'INFO',
          blocksStartup: false,
          resolution: 'None required.',
        },
        {
          name: 'Native Security Agent',
          status: 'WARNING',
          explanation: 'Native security agent is NOT_INSTALLED (Phase 1C target). Operating in application-level lockdown mode.',
          severity: 'WARNING',
          blocksStartup: false,
          resolution: 'Service will be registered in Phase 1C.',
        },
      ],
      timestamp: new Date().toISOString(),
      canProceed: true,
    })
  }
  return invoke<ExaminationStartupValidationReport>('secure_shell_run_startup_validation', { candidateAccountName })
}

/** Inspect crash detection and bounded recovery status (Stage 6). */
export function checkCrashRecovery(): Promise<CrashRecoveryReport> {
  if (!isTauri()) {
    return Promise.resolve({
      crashDetected: false,
      restartCount: 0,
      maxRestartsAllowed: 3,
      escalationRequired: false,
      preservedAssessmentId: null,
      preservedAttemptId: null,
      message: 'Previous session shut down cleanly. Normal operation.',
    })
  }
  return invoke<CrashRecoveryReport>('secure_shell_check_crash_recovery')
}

/** Preview normal-mode restoration steps (Stage 7). */
export function previewRestoration(targetAccount = 'AssessXCandidate'): Promise<RestorationPreview> {
  if (!isTauri()) {
    return Promise.resolve({
      isAdministrator: true,
      activeKioskDetected: true,
      automaticStartupActive: true,
      recordedChangesCount: 2,
      restorationSteps: [
        '1. Authenticate administrative credentials and verify elevated token.',
        `2. Remove kiosk / shell configuration for account '${targetAccount}'.`,
        '3. Restore Windows default Explorer shell (explorer.exe).',
        `4. Unregister automatic examination startup for '${targetAccount}'.`,
        '5. Verify system registry acceptance and log restoration in Change Journal.',
      ],
      warning: 'Restoration will return Windows to normal desktop mode for all accounts.',
    })
  }
  return invoke<RestorationPreview>('secure_shell_preview_restoration', { targetAccount })
}

/** Execute administrator-authorized restoration of default Windows desktop (Stage 7). */
export function executeRestoration(
  targetAccount = 'AssessXCandidate',
  adminConfirmed = false
): Promise<RestorationOperationResult> {
  if (!isTauri()) {
    if (!adminConfirmed) {
      return Promise.resolve({
        success: false,
        status: 'ERROR',
        restoredItems: [],
        message: 'Administrator confirmation required.',
        journalEntryId: null,
      })
    }
    return Promise.resolve({
      success: true,
      status: 'RESTORED',
      restoredItems: ['Automatic startup removed', 'Explorer shell restored'],
      message: 'Workstation successfully restored to normal Windows operation.',
      journalEntryId: 'JRN-SIMULATED-RESTORE',
    })
  }
  return invoke<RestorationOperationResult>('secure_shell_execute_restoration', {
    targetAccount,
    adminConfirmed,
  })
}

/** Inspect secure shell health and heartbeat status. */
export function getShellHealth(): Promise<ShellHealthReport> {
  if (!isTauri()) {
    return Promise.resolve({
      status: 'HEALTHY',
      currentLifecycleState: 'NORMAL_MODE',
      heartbeatAgeSeconds: 1,
      isResponsive: true,
      summary: 'Shell status: HEALTHY. State: NORMAL_MODE.',
    })
  }
  return invoke<ShellHealthReport>('secure_shell_get_health')
}

