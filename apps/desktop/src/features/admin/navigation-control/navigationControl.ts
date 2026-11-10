/**
 * Phase 2C: Keyboard Shortcut Restrictions & Navigation Control IPC Bridge.
 *
 * Exposes typed commands to interact with Shortcut Catalog, Navigation Policy Lifecycle,
 * Window/Focus Supervisor, Windows Navigation Status, and Accessibility Accommodations.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'
import type {
  AccessibilityAccommodationConfig,
  AccessibilityStatusReport,
  NavigationControlPolicyConfig,
  NavigationScanSummary,
  NavigationStatusReport,
  PolicyPreviewReport,
  ShortcutItem,
  WindowFocusReport,
} from './types'

export function isTauriEnvironment(): boolean {
  return isTauri()
}

/** Query standard shortcut inventory catalog. */
export function getShortcutCatalog(): Promise<ShortcutItem[]> {
  if (!isTauri()) {
    return Promise.resolve([
      {
        id: 'sc-alt-tab',
        keyCombination: 'Alt + Tab',
        description: 'Windows Task Switcher / Recent applications',
        category: 'ApplicationSwitching',
        riskLevel: 'Severe',
        enforcementType: 'NativeKeyboardFilter',
        defaultAction: 'Block',
        isKernelRestricted: false,
        targetInterface: 'TaskSwitcher',
      },
      {
        id: 'sc-ctrl-alt-del',
        keyCombination: 'Ctrl + Alt + Delete',
        description: 'Windows Secure Attention Sequence (SAS)',
        category: 'TaskAndSessionControl',
        riskLevel: 'CriticalAttention',
        enforcementType: 'KernelRestricted',
        defaultAction: 'KernelRestricted',
        isKernelRestricted: true,
        targetInterface: 'WinlogonSurface',
      },
      {
        id: 'sc-win-l',
        keyCombination: 'Win + L',
        description: 'Lock Computer workstation',
        category: 'TaskAndSessionControl',
        riskLevel: 'CriticalAttention',
        enforcementType: 'KernelRestricted',
        defaultAction: 'KernelRestricted',
        isKernelRestricted: true,
        targetInterface: 'LockScreen',
      },
      {
        id: 'sc-win-d',
        keyCombination: 'Win + D',
        description: 'Minimize all and show desktop surface',
        category: 'ShellAndDesktopNavigation',
        riskLevel: 'HighRisk',
        enforcementType: 'RegistryExplorerPolicy',
        defaultAction: 'Block',
        isKernelRestricted: false,
        targetInterface: 'WindowsExplorerDesktop',
      },
      {
        id: 'sc-win-r',
        keyCombination: 'Win + R',
        description: 'Open Run Dialog execution interface',
        category: 'ShellAndDesktopNavigation',
        riskLevel: 'Severe',
        enforcementType: 'RegistryExplorerPolicy',
        defaultAction: 'Block',
        isKernelRestricted: false,
        targetInterface: 'RunDialog',
      },
      {
        id: 'sc-printscreen',
        keyCombination: 'PrtScn / Alt + PrtScn',
        description: 'Direct desktop screen capture to clipboard',
        category: 'PrintAndScreenCapture',
        riskLevel: 'HighRisk',
        enforcementType: 'NativeKeyboardFilter',
        defaultAction: 'Block',
        isKernelRestricted: false,
        targetInterface: 'ScreenClippingTool',
      },
      {
        id: 'sc-sticky-keys',
        keyCombination: 'Shift (5 times)',
        description: 'Toggle Sticky Keys accommodation',
        category: 'AccessibilityAndSpecialKeys',
        riskLevel: 'LowRisk',
        enforcementType: 'NativeKeyboardFilter',
        defaultAction: 'Allow',
        isKernelRestricted: false,
        targetInterface: 'AccessibilitySubsystem',
      },
    ])
  }
  return invoke<ShortcutItem[]>('get_shortcut_catalog')
}

/** Get active navigation control policy. */
export function getNavigationPolicy(): Promise<NavigationControlPolicyConfig> {
  if (!isTauri()) {
    return Promise.resolve({
      id: 'default-nav-policy',
      version: 1,
      appSwitchingBlocked: true,
      windowsKeysBlocked: true,
      taskViewBlocked: true,
      screenCaptureBlocked: true,
      browserShortcutsBlocked: true,
      taskbarNavigationBlocked: true,
      runDialogBlocked: true,
      searchInterfaceBlocked: true,
      desktopSurfaceBlocked: true,
      accessibilityAccommodationsAllowed: true,
      customOverrides: [],
      candidateAccount: null,
      candidateSid: null,
      state: 'Active',
      adminApproved: true,
      updatedAt: '1731000000',
    })
  }
  return invoke<NavigationControlPolicyConfig>('get_navigation_policy')
}

/** Preview policy impact against shortcut catalog and accommodations. */
export function previewNavigationPolicy(
  policy: NavigationControlPolicyConfig,
  accommodations: AccessibilityAccommodationConfig,
): Promise<PolicyPreviewReport> {
  if (!isTauri()) {
    return Promise.resolve({
      totalShortcutsCovered: 24,
      blockedCount: 19,
      allowedCount: 3,
      kernelRestrictedCount: 2,
      accommodationsPreserved: true,
      conflicts: [],
    })
  }
  return invoke<PolicyPreviewReport>('preview_navigation_policy', {
    policy,
    accommodations,
  })
}

/** Validate and save navigation policy. */
export function validateAndSaveNavigationPolicy(
  policy: NavigationControlPolicyConfig,
): Promise<{ success: boolean; state: string; error?: string }> {
  if (!isTauri()) {
    return Promise.resolve({ success: true, state: 'Validated' })
  }
  return invoke<{ success: boolean; state: string; error?: string }>(
    'validate_and_save_navigation_policy',
    { policy },
  )
}

/** Apply approved navigation policy to system and candidate registry. */
export function applyNavigationPolicy(
  adminApprovalSignature: string,
): Promise<{ success: boolean; state: string; error?: string }> {
  if (!isTauri()) {
    return Promise.resolve({ success: true, state: 'Active' })
  }
  return invoke<{ success: boolean; state: string; error?: string }>(
    'apply_navigation_policy',
    { adminApprovalSignature },
  )
}

/** Rollback active navigation policy to baseline. */
export function rollbackNavigationPolicy(): Promise<{ success: boolean; state: string }> {
  if (!isTauri()) {
    return Promise.resolve({ success: true, state: 'RolledBack' })
  }
  return invoke<{ success: boolean; state: string }>('rollback_navigation_policy')
}

/** Inspect current window focus and foreground target class. */
export function inspectWindowFocus(): Promise<WindowFocusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      activeForegroundTitle: 'AssessX Administrator Portal',
      activeForegroundProcess: 'assessx-desktop.exe',
      activeForegroundClass: 'Chrome_WidgetWin_1',
      targetClass: 'AssessXExamWindow',
      isMinimised: false,
      lossOfFocusCount: 0,
      lastFocusLossTimestamp: null,
      isExamWindowForeground: true,
    })
  }
  return invoke<WindowFocusReport>('inspect_window_focus')
}

/** Inspect Windows Explorer navigation restriction registry state. */
export function inspectNavigationStatus(): Promise<NavigationStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      windowsKeysBlocked: true,
      runDialogBlocked: true,
      searchInterfaceBlocked: true,
      taskbarNavigationBlocked: true,
      desktopSurfaceBlocked: true,
      taskViewBlocked: true,
      allShellPoliciesEnforced: true,
      candidateAccountScoped: false,
      lastVerifiedAt: new Date().toISOString(),
    })
  }
  return invoke<NavigationStatusReport>('inspect_navigation_status')
}

/** Inspect Windows accessibility subsystem accommodation status. */
export function inspectAccessibilityStatus(): Promise<AccessibilityStatusReport> {
  if (!isTauri()) {
    return Promise.resolve({
      stickyKeysDetected: false,
      filterKeysDetected: false,
      highContrastDetected: false,
      screenReaderDetected: false,
      accommodationsActiveCount: 0,
      hasConflicts: false,
      conflictDescription: null,
    })
  }
  return invoke<AccessibilityStatusReport>('inspect_accessibility_status')
}

/** Run comprehensive navigation and shortcut violation scan. */
export function scanNavigationViolations(): Promise<NavigationScanSummary> {
  if (!isTauri()) {
    return Promise.resolve({
      isEnvironmentCompliant: true,
      violationsCount: 0,
      focusState: {
        activeForegroundTitle: 'AssessX Administrator Portal',
        activeForegroundProcess: 'assessx-desktop.exe',
        activeForegroundClass: 'Chrome_WidgetWin_1',
        targetClass: 'AssessXExamWindow',
        isMinimised: false,
        lossOfFocusCount: 0,
        lastFocusLossTimestamp: null,
        isExamWindowForeground: true,
      },
      violations: [],
    })
  }
  return invoke<NavigationScanSummary>('scan_navigation_violations')
}

