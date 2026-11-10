/**
 * Phase 2D: Peripheral, Display & Remote-Access Control IPC Bridge.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'
import type {
  DisplayTopologyReport,
  PeripheralPolicyConfig,
  PeripheralPolicyPreviewReport,
  PeripheralScanSummary,
  RemoteAccessStatusReport,
  StorageStatusReport,
} from './types'

export function isTauriEnvironment(): boolean {
  return isTauri()
}

/** Query USB and Removable Storage status. */
export function inspectStorageStatus(): Promise<StorageStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      activeMode: 'AuditOnly',
      connectedRemovableDrivesCount: 0,
      removableDrives: [],
      usbstorServiceStart: 3,
      removableStorageDenyAllPolicy: false,
      candidateAccountScoped: true,
      isPolicyEnforced: true,
      lastInspectedAt: new Date().toISOString(),
    })
  }
  return invoke<StorageStatusReport>('inspect_storage_status')
}

/** Query Display Topology & Peripheral Readiness. */
export function inspectDisplayTopology(): Promise<DisplayTopologyReport> {
  if (!isTauri()) {
    return Promise.resolve({
      monitorCount: 1,
      primaryWidth: 1920,
      primaryHeight: 1080,
      virtualScreenWidth: 1920,
      virtualScreenHeight: 1080,
      monitors: [
        {
          monitorId: 'mon-1',
          deviceName: '\\\\.\\DISPLAY1',
          width: 1920,
          height: 1080,
          isPrimary: true,
          isVirtualDisplay: false,
        },
      ],
      hasVirtualDisplay: false,
      multipleMonitorsDetected: false,
      isTopologyCompliant: true,
      peripherals: {
        cameraDetected: true,
        microphoneDetected: true,
        keyboardDetected: true,
        mouseDetected: true,
        audioOutputDetected: true,
        allRequiredPeripheralsReady: true,
      },
      lastCheckedAt: new Date().toISOString(),
    })
  }
  return invoke<DisplayTopologyReport>('inspect_display_topology')
}

/** Query Remote Access Sessions & Software. */
export function inspectRemoteAccessStatus(): Promise<RemoteAccessStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      isRemoteSessionActive: false,
      rdpDeniedByPolicy: true,
      runningRemoteToolsCount: 0,
      detectedRemoteTools: [],
      classification: 'RemoteAccessDisabled',
      isEnvironmentSecure: true,
      lastInspectedAt: new Date().toISOString(),
    })
  }
  return invoke<RemoteAccessStatusReport>('inspect_remote_access_status')
}

/** Get Active Peripheral Policy. */
export function getPeripheralPolicy(): Promise<PeripheralPolicyConfig> {
  if (!isTauri()) {
    return Promise.resolve({
      id: 'default-peripheral-policy',
      version: 1,
      storageMode: 'AuditOnly',
      maxMonitors: 1,
      allowVirtualDisplays: false,
      blockRemoteSessions: true,
      blockRemoteTools: true,
      requireCamera: true,
      requireMicrophone: true,
      candidateAccount: 'AssessXCandidate',
      candidateSid: null,
      state: 'Active',
      adminApproved: true,
      updatedAt: '1731000000',
    })
  }
  return invoke<PeripheralPolicyConfig>('get_peripheral_policy')
}

/** Preview Peripheral Policy Impact. */
export function previewPeripheralPolicy(
  policy: PeripheralPolicyConfig,
): Promise<PeripheralPolicyPreviewReport> {
  if (!isTauri()) {
    return Promise.resolve({
      storageImpactMode: policy.storageMode,
      removableDrivesAffectedCount: 0,
      currentMonitorCount: 1,
      maxAllowedMonitors: policy.maxMonitors,
      displayViolation: false,
      virtualDisplayDetected: false,
      remoteSessionDetected: false,
      detectedRemoteToolsCount: 0,
      conflicts: [],
    })
  }
  return invoke<PeripheralPolicyPreviewReport>('preview_peripheral_policy', { policy })
}

/** Validate and save peripheral policy. */
export function validateAndSavePeripheralPolicy(
  policy: PeripheralPolicyConfig,
): Promise<{ success: boolean; state: string; error?: string }> {
  if (!isTauri()) {
    return Promise.resolve({ success: true, state: 'Validated' })
  }
  return invoke<{ success: boolean; state: string; error?: string }>(
    'validate_and_save_peripheral_policy',
    { policy },
  )
}

/** Apply approved peripheral policy. */
export function applyPeripheralPolicy(
  adminApprovalSignature: string,
): Promise<{ success: boolean; state: string; error?: string }> {
  if (!isTauri()) {
    return Promise.resolve({ success: true, state: 'Active' })
  }
  return invoke<{ success: boolean; state: string; error?: string }>(
    'apply_peripheral_policy',
    { adminApprovalSignature },
  )
}

/** Rollback active peripheral policy to baseline. */
export function rollbackPeripheralPolicy(): Promise<{ success: boolean; state: string }> {
  if (!isTauri()) {
    return Promise.resolve({ success: true, state: 'RolledBack' })
  }
  return invoke<{ success: boolean; state: string }>('rollback_peripheral_policy')
}

/** Scan Peripheral & Remote-Access Violations. */
export function scanPeripheralViolations(): Promise<PeripheralScanSummary> {
  if (!isTauri()) {
    return Promise.resolve({
      isEnvironmentCompliant: true,
      violationsCount: 0,
      storageReport: {
        activeMode: 'AuditOnly',
        connectedRemovableDrivesCount: 0,
        removableDrives: [],
        usbstorServiceStart: 3,
        removableStorageDenyAllPolicy: false,
        candidateAccountScoped: true,
        isPolicyEnforced: true,
        lastInspectedAt: new Date().toISOString(),
      },
      displayReport: {
        monitorCount: 1,
        primaryWidth: 1920,
        primaryHeight: 1080,
        virtualScreenWidth: 1920,
        virtualScreenHeight: 1080,
        monitors: [],
        hasVirtualDisplay: false,
        multipleMonitorsDetected: false,
        isTopologyCompliant: true,
        peripherals: {
          cameraDetected: true,
          microphoneDetected: true,
          keyboardDetected: true,
          mouseDetected: true,
          audioOutputDetected: true,
          allRequiredPeripheralsReady: true,
        },
        lastCheckedAt: new Date().toISOString(),
      },
      remoteReport: {
        isRemoteSessionActive: false,
        rdpDeniedByPolicy: true,
        runningRemoteToolsCount: 0,
        detectedRemoteTools: [],
        classification: 'RemoteAccessDisabled',
        isEnvironmentSecure: true,
        lastInspectedAt: new Date().toISOString(),
      },
      violations: [],
    })
  }
  return invoke<PeripheralScanSummary>('scan_peripheral_violations')
}

