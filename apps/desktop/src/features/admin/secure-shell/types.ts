/**
 * TypeScript interfaces for Phase 1B Secure Shell & Examination Startup.
 * Matches camelCase serialization from Rust secure_shell submodules.
 */

import type { WindowsCompatibilityReport } from '../provisioning/types'

export interface KioskMechanismCapability {
  mechanismName: string
  isSupported: boolean
  isConfigured: boolean
  status: 'SUPPORTED' | 'CONFIGURED' | 'UNSUPPORTED_EDITION' | 'FEATURE_DISABLED' | 'REQUIRES_ELEVATION'
  missingFeatures: string[]
  requiredPermissions: string
  details: string
}

export interface KioskCapabilityReport {
  windowsCompatibility: WindowsCompatibilityReport
  assignedAccess: KioskMechanismCapability
  shellLauncher: KioskMechanismCapability
  recommendedMechanism: 'ASSIGNED_ACCESS' | 'SHELL_LAUNCHER' | 'UNSUPPORTED'
  overallStatus: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'UNSUPPORTED' | 'REQUIRES_ADMINISTRATOR'
  limitations: string[]
  summary: string
}

export interface KioskConfigPreview {
  targetAccount: string
  mechanism: string
  executablePath: string
  requiresElevation: boolean
  isSupported: boolean
  plannedSteps: string[]
  rollbackSteps: string[]
  warning: string
}

export interface KioskOperationResult {
  success: boolean
  currentState: 'CONFIGURED' | 'NOT_CONFIGURED' | 'ADMIN_APPROVAL_REQUIRED' | 'VERIFICATION_FAILED' | 'ERROR'
  message: string
  journalEntryId: string | null
}

export interface StartupConfigurationReport {
  isConfigured: boolean
  targetAccount: string
  executablePath: string
  startupMechanism: 'WINDOWS_RUN_KEY' | 'TASK_SCHEDULER' | 'SHELL_LAUNCHER' | 'NOT_CONFIGURED'
  status: 'CONFIGURED' | 'NOT_CONFIGURED' | 'BROKEN_PATH' | 'DUPLICATE_ENTRIES' | 'REQUIRES_ELEVATION'
  executableExists: boolean
  accountExists: boolean
  details: string
  warnings: string[]
}

export interface StartupOperationResult {
  success: boolean
  status: string
  message: string
  journalEntryId: string | null
}

export interface DisplayInfo {
  displayId: string
  name: string
  width: number
  height: number
  scaleFactor: number
  isPrimary: boolean
}

export interface DisplayTopologyReport {
  monitorCount: number
  primaryDisplay: DisplayInfo | null
  displays: DisplayInfo[]
  isMultiMonitor: boolean
  isFullscreen: boolean
  isFocused: boolean
  status: 'PASS' | 'VIOLATION_MULTI_MONITOR' | 'NOT_FULLSCREEN'
  message: string
}

export type SessionLifecycleState =
  | 'DEVICE_STARTUP'
  | 'WINDOWS_USER_SESSION'
  | 'SECURE_SHELL_STARTING'
  | 'SECURE_SHELL_READY'
  | 'SECURITY_VALIDATION'
  | 'SESSION_READY'
  | 'EXAMINATION_ACTIVE'
  | 'EXAMINATION_INTERRUPTED'
  | 'RECOVERY_IN_PROGRESS'
  | 'AUTHORISED_EXIT_PENDING'
  | 'RESTORATION_IN_PROGRESS'
  | 'NORMAL_MODE'
  | 'ERROR'
  | 'ADMIN_RECOVERY_REQUIRED'

export interface StartupValidationCheck {
  name: string
  status: 'PASS' | 'WARNING' | 'BLOCKED'
  explanation: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  blocksStartup: boolean
  resolution: string
}

export interface ExaminationStartupValidationReport {
  overallResult: 'READY' | 'READY_WITH_WARNINGS' | 'BLOCKED' | 'ERROR'
  checks: StartupValidationCheck[]
  timestamp: string
  canProceed: boolean
}

export interface CrashRecoveryReport {
  crashDetected: boolean
  restartCount: number
  maxRestartsAllowed: number
  escalationRequired: boolean
  preservedAssessmentId: string | null
  preservedAttemptId: string | null
  message: string
}

export interface RestorationPreview {
  isAdministrator: boolean
  activeKioskDetected: boolean
  automaticStartupActive: boolean
  recordedChangesCount: number
  restorationSteps: string[]
  warning: string
}

export interface RestorationOperationResult {
  success: boolean
  status: 'RESTORED' | 'REQUIRES_ELEVATION' | 'VERIFICATION_FAILED' | 'ERROR'
  restoredItems: string[]
  message: string
  journalEntryId: string | null
}

export interface ShellHealthReport {
  status: 'HEALTHY' | 'DEGRADED' | 'UNRESPONSIVE' | 'RECOVERING' | 'FAILED'
  currentLifecycleState: string
  heartbeatAgeSeconds: number
  isResponsive: boolean
  summary: string
}

