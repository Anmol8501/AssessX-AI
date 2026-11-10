/**
 * Types for AssessX Keyboard Shortcut Restrictions & Navigation Control (Phase 2C).
 */

export type ShortcutRiskLevel =
  | 'LowRisk'
  | 'MediumRisk'
  | 'HighRisk'
  | 'Severe'
  | 'CriticalAttention';

export type ShortcutAction = 'Allow' | 'Block' | 'WarnAndLog' | 'KernelRestricted';

export type ShortcutCategory =
  | 'ApplicationSwitching'
  | 'ShellAndDesktopNavigation'
  | 'TaskAndSessionControl'
  | 'BrowserAndApplicationShortcuts'
  | 'ClipboardAndContent'
  | 'PrintAndScreenCapture'
  | 'AccessibilityAndSpecialKeys';

export type ShortcutEnforcementType =
  | 'NativeKeyboardFilter'
  | 'RegistryExplorerPolicy'
  | 'LowLevelHook'
  | 'KernelRestricted'
  | 'ApplicationLevel';

export interface ShortcutItem {
  id: string;
  keyCombination: string;
  description: string;
  category: ShortcutCategory;
  riskLevel: ShortcutRiskLevel;
  enforcementType: ShortcutEnforcementType;
  defaultAction: ShortcutAction;
  isKernelRestricted: boolean;
  targetInterface: string;
}

export type NavigationPolicyLifecycleState =
  | 'Draft'
  | 'Validated'
  | 'AwaitingAdminApproval'
  | 'Applying'
  | 'Verifying'
  | 'Active'
  | 'RollbackNeeded'
  | 'RolledBack';

export interface ShortcutOverride {
  shortcutId: string;
  action: ShortcutAction;
  justification: string;
}

export interface NavigationControlPolicyConfig {
  id: string;
  version: number;
  appSwitchingBlocked: boolean;
  windowsKeysBlocked: boolean;
  taskViewBlocked: boolean;
  screenCaptureBlocked: boolean;
  browserShortcutsBlocked: boolean;
  taskbarNavigationBlocked: boolean;
  runDialogBlocked: boolean;
  searchInterfaceBlocked: boolean;
  desktopSurfaceBlocked: boolean;
  accessibilityAccommodationsAllowed: boolean;
  customOverrides: ShortcutOverride[];
  candidateAccount: string | null;
  candidateSid: string | null;
  state: NavigationPolicyLifecycleState;
  adminApproved: boolean;
  updatedAt: string;
}

export type FocusTargetClass =
  | 'AssessXExamWindow'
  | 'ForeignApplication'
  | 'BareDesktop'
  | 'SystemSurface'
  | 'Unknown';

export interface WindowFocusReport {
  activeForegroundTitle: string;
  activeForegroundProcess: string;
  activeForegroundClass: string;
  targetClass: FocusTargetClass;
  isMinimised: boolean;
  lossOfFocusCount: number;
  lastFocusLossTimestamp: string | null;
  isExamWindowForeground: boolean;
}

export interface NavigationStatusReport {
  windowsKeysBlocked: boolean;
  runDialogBlocked: boolean;
  searchInterfaceBlocked: boolean;
  taskbarNavigationBlocked: boolean;
  desktopSurfaceBlocked: boolean;
  taskViewBlocked: boolean;
  allShellPoliciesEnforced: boolean;
  candidateAccountScoped: boolean;
  lastVerifiedAt: string | null;
}

export interface AccessibilityAccommodationConfig {
  stickyKeysPermitted: boolean;
  filterKeysPermitted: boolean;
  toggleKeysPermitted: boolean;
  highContrastPermitted: boolean;
  screenReaderActive: boolean;
  magnifierActive: boolean;
  accommodationNotes: string | null;
}

export interface AccessibilityStatusReport {
  stickyKeysDetected: boolean;
  filterKeysDetected: boolean;
  highContrastDetected: boolean;
  screenReaderDetected: boolean;
  accommodationsActiveCount: number;
  hasConflicts: boolean;
  conflictDescription: string | null;
}

export interface NavigationScanViolation {
  violationType: string;
  severity: string;
  description: string;
  targetComponent: string;
  timestamp: string;
}

export interface NavigationScanSummary {
  isEnvironmentCompliant: boolean;
  violationsCount: number;
  focusState: WindowFocusReport;
  violations: NavigationScanViolation[];
}

export interface PolicyPreviewReport {
  totalShortcutsCovered: number;
  blockedCount: number;
  allowedCount: number;
  kernelRestrictedCount: number;
  accommodationsPreserved: boolean;
  conflicts: string[];
}

