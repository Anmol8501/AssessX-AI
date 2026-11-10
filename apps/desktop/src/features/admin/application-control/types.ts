/**
 * Types for AssessX Application Allowlisting & Execution Control (Phase 2A).
 */

export type SignatureStatus =
  | 'SignedTrusted'
  | 'SignedUntrusted'
  | 'Unsigned'
  | 'Unknown';

export interface ApplicationIdentity {
  applicationId: string;
  displayName: string;
  executableName: string;
  executablePath: string;
  publisher: string | null;
  fileHash: string;
  fileVersion: string | null;
  signatureStatus: SignatureStatus;
  isRunning: boolean;
  processIds: number[];
  verifiedAt: string;
}

export type AllowlistCategory =
  | 'CoreAssessX'
  | 'WindowsSystem'
  | 'ApprovedSupport'
  | 'ApprovedAccessibility'
  | 'ApprovedInput'
  | 'BlockedApplication';

export type RuleType = 'Publisher' | 'Hash' | 'Path' | 'ExecutableName';

export type RuleAction = 'Allow' | 'Deny' | 'Audit';

export interface AllowlistEntry {
  id: string;
  name: string;
  category: AllowlistCategory;
  ruleType: RuleType;
  ruleValue: string;
  action: RuleAction;
  reason: string;
  isSystemRule: boolean;
  createdAt: string;
}

export type EnforcementMechanism =
  | 'Wdac'
  | 'AppLocker'
  | 'ProcessSupervision'
  | 'None';

export type CapabilityStatus =
  | 'Supported'
  | 'PartiallySupported'
  | 'RequiresAdmin'
  | 'Unsupported';

export interface EnforcementCapabilityReport {
  primaryMechanism: EnforcementMechanism;
  status: CapabilityStatus;
  windowsEdition: string;
  windowsBuild: string;
  wdacSupported: boolean;
  applockerSupported: boolean;
  appidsvcRunning: boolean;
  processSupervisionActive: boolean;
  isEnforcementCapable: boolean;
  summary: string;
  recommendations: string[];
}

export type PolicyLifecycleState =
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

export type PolicyMode = 'AuditMode' | 'EnforcementMode';

export interface PolicyEngineState {
  policyId: string;
  version: number;
  mode: PolicyMode;
  state: PolicyLifecycleState;
  lastUpdated: string;
}

export interface PolicyPreview {
  policyId: string;
  policyVersion: number;
  mode: PolicyMode;
  currentState: PolicyLifecycleState;
  totalRules: number;
  allowedCount: number;
  deniedCount: number;
  plannedActions: string[];
  rollbackActions: string[];
  isSafeToApply: boolean;
  validationErrors: string[];
}

export interface PolicyOperationResult {
  success: boolean;
  currentState: PolicyLifecycleState;
  message: string;
  timestamp: string;
}

export type ApplicationClassification =
  | 'ApprovedApplication'
  | 'UnknownApplication'
  | 'UnapprovedApplication'
  | 'DeniedApplication'
  | 'IdentityVerificationFailed';

export interface ApplicationViolation {
  application: ApplicationIdentity;
  classification: ApplicationClassification;
  reason: string;
  actionTaken: string;
}

export interface ApplicationScanSummary {
  totalScanned: number;
  approvedCount: number;
  deniedCount: number;
  unapprovedCount: number;
  hasViolations: boolean;
  violations: ApplicationViolation[];
}

