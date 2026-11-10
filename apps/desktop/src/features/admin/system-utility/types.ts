/**
 * Types for AssessX System Utility Restrictions (Phase 2B).
 */

export type SystemUtilityCategory =
  | 'CommandAndScripting'
  | 'ProcessAndTaskManagement'
  | 'AdministrativeInterfaces'
  | 'SystemConfiguration'
  | 'FileAndNavigation'
  | 'CustomUtility';

export type UtilityPolicyAction = 'Allow' | 'Restrict' | 'Block' | 'Monitor';

export type CriticalityLevel =
  | 'CriticalProtected'
  | 'HighRisk'
  | 'MediumRisk'
  | 'LowRisk';

export interface SystemUtilityItem {
  utilityId: string;
  displayName: string;
  executableName: string;
  knownPaths: string[];
  resolvedPath: string | null;
  category: SystemUtilityCategory;
  publisher: string | null;
  fileHash: string | null;
  defaultAction: UtilityPolicyAction;
  criticality: CriticalityLevel;
  isCriticalProtected: boolean;
  isInstalled: boolean;
}

export type PowerShellRestrictionMode =
  | 'Allow'
  | 'Restrict'
  | 'Block'
  | 'DetectionOnly';

export type PowerShellState =
  | 'Available'
  | 'Restricted'
  | 'BlockedByPolicy'
  | 'DetectionOnly'
  | 'Unsupported'
  | 'VerificationFailed'
  | 'Error';

export interface PowerShellStatusReport {
  winPowershellInstalled: boolean;
  winPowershellPath: string | null;
  winPowershellVersion: string | null;
  winPowershellHash: string | null;
  pwsh7Installed: boolean;
  pwsh7Path: string | null;
  pwsh7Version: string | null;
  pwsh7Hash: string | null;
  activeMode: PowerShellRestrictionMode;
  currentState: PowerShellState;
  runningInstancesCount: number;
  candidateAccountScoped: boolean;
  lastVerifiedAt: string | null;
}

export type CmdRestrictionMode = 'Allow' | 'Restrict' | 'Block' | 'DetectionOnly';

export type CmdState =
  | 'Available'
  | 'Restricted'
  | 'BlockedByPolicy'
  | 'DetectionOnly'
  | 'Unsupported'
  | 'VerificationFailed'
  | 'Error';

export interface CmdStatusReport {
  isInstalled: boolean;
  primaryPath: string | null;
  fileHash: string | null;
  fileVersion: string | null;
  activeMode: CmdRestrictionMode;
  currentState: CmdState;
  disableCmdRegistryValue: number | null;
  runningInstancesCount: number;
  candidateAccountScoped: boolean;
  lastVerifiedAt: string | null;
}

export type TaskManagerRestrictionMode = 'Allow' | 'Block' | 'DetectionOnly';

export type TaskManagerState =
  | 'Available'
  | 'BlockedByPolicy'
  | 'DetectionOnly'
  | 'Unsupported'
  | 'VerificationFailed'
  | 'Error';

export interface TaskManagerStatusReport {
  isInstalled: boolean;
  primaryPath: string | null;
  fileHash: string | null;
  fileVersion: string | null;
  activeMode: TaskManagerRestrictionMode;
  currentState: TaskManagerState;
  disableTaskmgrRegistryValue: number | null;
  runningInstancesCount: number;
  candidateAccountScoped: boolean;
  lastVerifiedAt: string | null;
}

export type UtilityPolicyLifecycleState =
  | 'Draft'
  | 'Validated'
  | 'AwaitingAdminApproval'
  | 'Applying'
  | 'Verifying'
  | 'Active'
  | 'ValidationFailed'
  | 'ApprovalDenied'
  | 'ApplyFailed'
  | 'VerificationFailed'
  | 'RestorationRequired';

export interface UtilityPolicyRule {
  utilityId: string;
  executableName: string;
  action: UtilityPolicyAction;
  reason: string;
}

export interface SystemUtilityPolicyConfig {
  id: string;
  version: number;
  powershellMode: PowerShellRestrictionMode;
  cmdMode: CmdRestrictionMode;
  taskManagerMode: TaskManagerRestrictionMode;
  registryToolsBlocked: boolean;
  utilityRules: UtilityPolicyRule[];
  candidateAccount: string | null;
  candidateSid: string | null;
  state: UtilityPolicyLifecycleState;
  adminApproved: boolean;
  updatedAt: string;
}

export interface UtilityConflictItem {
  executableName: string;
  conflictType: string;
  severity: string;
  description: string;
  recommendedResolution: string;
}

export interface UtilityPolicyPreview {
  totalRules: number;
  blockedUtilitiesCount: number;
  restrictedUtilitiesCount: number;
  conflicts: UtilityConflictItem[];
  isValid: boolean;
  affectedRegistryKeys: string[];
  safetySummary: string;
}

export type UtilityEventClassification =
  | 'PowerShellExecutionDetected'
  | 'PowerShellExecutionBlocked'
  | 'CmdExecutionDetected'
  | 'CmdExecutionBlocked'
  | 'TaskManagerAccessDetected'
  | 'TaskManagerAccessBlocked'
  | 'SystemUtilityAccessDetected'
  | 'SystemUtilityAccessBlocked';

export interface UtilityViolation {
  executableName: string;
  executablePath: string | null;
  processId: number;
  classification: UtilityEventClassification;
  actionTaken: string;
  policyRule: string;
}

export interface SystemUtilityScanSummary {
  totalProcessesChecked: number;
  violationsCount: number;
  hasViolations: boolean;
  violations: UtilityViolation[];
}

