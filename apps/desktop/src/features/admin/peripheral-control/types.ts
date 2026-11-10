/**
 * Types for AssessX USB Storage, Display Topology & Remote Access Restrictions (Phase 2D).
 */

export type StoragePolicyMode =
  | 'AllowAllSupported'
  | 'BlockUnapprovedStorage'
  | 'AllowApprovedDevices'
  | 'AuditOnly';

export interface RemovableStorageDevice {
  driveLetter: string;
  volumeName: string;
  fileSystem: string;
  isRemovable: boolean;
  isBlocked: boolean;
  totalSpaceBytes: number | null;
}

export interface StorageStatusReport {
  activeMode: StoragePolicyMode;
  connectedRemovableDrivesCount: number;
  removableDrives: RemovableStorageDevice[];
  usbstorServiceStart: number;
  removableStorageDenyAllPolicy: boolean;
  candidateAccountScoped: boolean;
  isPolicyEnforced: boolean;
  lastInspectedAt: string;
}

export interface MonitorInfo {
  monitorId: string;
  deviceName: string;
  width: number;
  height: number;
  isPrimary: boolean;
  isVirtualDisplay: boolean;
}

export interface PeripheralReadinessReport {
  cameraDetected: boolean;
  microphoneDetected: boolean;
  keyboardDetected: boolean;
  mouseDetected: boolean;
  audioOutputDetected: boolean;
  allRequiredPeripheralsReady: boolean;
}

export interface DisplayTopologyReport {
  monitorCount: number;
  primaryWidth: number;
  primaryHeight: number;
  virtualScreenWidth: number;
  virtualScreenHeight: number;
  monitors: MonitorInfo[];
  hasVirtualDisplay: boolean;
  multipleMonitorsDetected: boolean;
  isTopologyCompliant: boolean;
  peripherals: PeripheralReadinessReport;
  lastCheckedAt: string;
}

export type RemoteAccessClassification =
  | 'RemoteAccessDisabled'
  | 'RemoteAccessAllowedByPolicy'
  | 'RemoteSessionDetected'
  | 'RemoteToolDetected'
  | 'RemoteAccessPolicyWarning'
  | 'RemoteAccessPolicyViolation';

export interface DetectedRemoteTool {
  toolName: string;
  executableName: string;
  processId: number;
  isRunning: boolean;
  category: string;
}

export interface RemoteAccessStatusReport {
  isRemoteSessionActive: boolean;
  rdpDeniedByPolicy: boolean;
  runningRemoteToolsCount: number;
  detectedRemoteTools: DetectedRemoteTool[];
  classification: RemoteAccessClassification;
  isEnvironmentSecure: boolean;
  lastInspectedAt: string;
}

export type PeripheralPolicyLifecycleState =
  | 'Draft'
  | 'Validated'
  | 'AwaitingAdminApproval'
  | 'Applying'
  | 'Verifying'
  | 'Active'
  | 'RollbackNeeded'
  | 'RolledBack';

export interface PeripheralPolicyConfig {
  id: string;
  version: number;
  storageMode: StoragePolicyMode;
  maxMonitors: number;
  allowVirtualDisplays: boolean;
  blockRemoteSessions: boolean;
  blockRemoteTools: boolean;
  requireCamera: boolean;
  requireMicrophone: boolean;
  candidateAccount: string | null;
  candidateSid: string | null;
  state: PeripheralPolicyLifecycleState;
  adminApproved: boolean;
  updatedAt: string;
}

export interface PeripheralPolicyPreviewReport {
  storageImpactMode: StoragePolicyMode;
  removableDrivesAffectedCount: number;
  currentMonitorCount: number;
  maxAllowedMonitors: number;
  displayViolation: boolean;
  virtualDisplayDetected: boolean;
  remoteSessionDetected: boolean;
  detectedRemoteToolsCount: number;
  conflicts: string[];
}

export interface PeripheralScanViolation {
  violationType: string;
  severity: string;
  targetDevice: string;
  description: string;
  timestamp: string;
}

export interface PeripheralScanSummary {
  isEnvironmentCompliant: boolean;
  violationsCount: number;
  storageReport: StorageStatusReport;
  displayReport: DisplayTopologyReport;
  remoteReport: RemoteAccessStatusReport;
  violations: PeripheralScanViolation[];
}
