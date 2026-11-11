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
interface RawShortcutItem {
  shortcutId: string
  displayName: string
  keyCombination: string
  category: string
  description: string
  riskLevel: string
  defaultAction: string
  enforcementType: string
  isAccessibilityKey: boolean
  isSystemReserved: boolean
}

const CATEGORY_MAP: Record<string, ShortcutItem['category']> = {
  AppSwitching: 'ApplicationSwitching',
  ShellAndDesktop: 'ShellAndDesktopNavigation',
  TaskAndSession: 'TaskAndSessionControl',
  BrowserAndNav: 'BrowserAndApplicationShortcuts',
  ClipboardTransfer: 'ClipboardAndContent',
  PrintAndCapture: 'PrintAndScreenCapture',
  Accessibility: 'AccessibilityAndSpecialKeys',
}

const RISK_MAP: Record<string, ShortcutItem['riskLevel']> = {
  Critical: 'CriticalAttention',
  High: 'HighRisk',
  Medium: 'MediumRisk',
  Low: 'LowRisk',
  AccessibilityAccommodation: 'LowRisk',
}

export async function getShortcutCatalog(): Promise<ShortcutItem[]> {
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
  const items = await invoke<RawShortcutItem[]>('get_shortcut_inventory')
  return items.map((item) => ({
    id: item.shortcutId,
    keyCombination: item.keyCombination,
    description: item.description,
    category: CATEGORY_MAP[item.category] ?? 'BrowserAndApplicationShortcuts',
    riskLevel: RISK_MAP[item.riskLevel] ?? 'MediumRisk',
    enforcementType:
      item.enforcementType === 'WindowsNativePolicy'
        ? 'RegistryExplorerPolicy'
        : item.enforcementType === 'FrontendInterception'
          ? 'ApplicationLevel'
          : (item.enforcementType as ShortcutItem['enforcementType']),
    defaultAction: item.isSystemReserved
      ? 'KernelRestricted'
      : ((item.defaultAction === 'Monitor' || item.defaultAction === 'Restrict'
          ? 'WarnAndLog'
          : item.defaultAction) as ShortcutItem['defaultAction']),
    isKernelRestricted: item.isSystemReserved,
    targetInterface: item.displayName,
  }))
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
export async function previewNavigationPolicy(
  policy: NavigationControlPolicyConfig,
  _accommodations: AccessibilityAccommodationConfig,
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
  const raw = await invoke<{
    totalShortcutsConfigured: number
    totalBlocked: number
    totalMonitored: number
    accessibilityExceptionsActive: number
    conflicts: { description: string }[]
  }>('preview_navigation_policy', { policy })
  const kernelCount = raw.conflicts.filter((c) => c.description.includes('Winlogon')).length
  return {
    totalShortcutsCovered: raw.totalShortcutsConfigured,
    blockedCount: raw.totalBlocked,
    allowedCount: Math.max(0, raw.totalShortcutsConfigured - raw.totalBlocked),
    kernelRestrictedCount: kernelCount,
    accommodationsPreserved: policy.accessibilityAccommodationsAllowed,
    conflicts: raw.conflicts.map((c) => c.description),
  }
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
export async function applyNavigationPolicy(
  _adminApprovalSignature: string,
  policy?: NavigationControlPolicyConfig,
): Promise<{ success: boolean; state: string; error?: string }> {
  if (!isTauri()) {
    return Promise.resolve({ success: true, state: 'Active' })
  }
  try {
    const applied = await invoke<NavigationControlPolicyConfig>('apply_navigation_policy', {
      policy: policy ?? null,
      adminApproved: true,
    })
    return { success: true, state: applied.state }
  } catch (err) {
    return {
      success: false,
      state: 'VerificationFailed',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Rollback active navigation policy to baseline. */
export async function rollbackNavigationPolicy(): Promise<{ success: boolean; state: string }> {
  if (!isTauri()) {
    return Promise.resolve({ success: true, state: 'RolledBack' })
  }
  await invoke<NavigationControlPolicyConfig>('revert_navigation_policy')
  return { success: true, state: 'RolledBack' }
}

/** Inspect current window focus and foreground target class. */
export async function inspectWindowFocus(): Promise<WindowFocusReport> {
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
  const raw = await invoke<{
    isAssessxForeground: boolean
    isMinimized: boolean
    activeForegroundTitle: string
    activeForegroundProcess: string
    focusClassification: WindowFocusReport['targetClass']
    recoveryAttemptsCount: number
    timestamp: string
  }>('inspect_window_focus')
  return {
    activeForegroundTitle: raw.activeForegroundTitle,
    activeForegroundProcess: raw.activeForegroundProcess,
    activeForegroundClass: raw.focusClassification,
    targetClass: raw.focusClassification,
    isMinimised: raw.isMinimized,
    lossOfFocusCount: raw.recoveryAttemptsCount,
    lastFocusLossTimestamp: raw.isAssessxForeground ? null : raw.timestamp,
    isExamWindowForeground: raw.isAssessxForeground,
  }
}

/** Inspect Windows Explorer navigation restriction registry state. */
export async function inspectNavigationStatus(): Promise<NavigationStatusReport> {
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
  const raw = await invoke<{
    windowsKeysDisabled: boolean
    runDialogDisabled: boolean
    searchInterfaceDisabled: boolean
    taskbarContextMenuDisabled: boolean
    taskbarSettingsDisabled: boolean
    desktopSurfaceDisabled: boolean
    candidateAccountScoped: boolean
    lastVerifiedAt: string | null
  }>('inspect_navigation_status')
  const taskbar = raw.taskbarContextMenuDisabled || raw.taskbarSettingsDisabled
  return {
    windowsKeysBlocked: raw.windowsKeysDisabled,
    runDialogBlocked: raw.runDialogDisabled,
    searchInterfaceBlocked: raw.searchInterfaceDisabled,
    taskbarNavigationBlocked: taskbar,
    desktopSurfaceBlocked: raw.desktopSurfaceDisabled,
    taskViewBlocked: raw.windowsKeysDisabled,
    allShellPoliciesEnforced:
      raw.windowsKeysDisabled &&
      raw.runDialogDisabled &&
      raw.searchInterfaceDisabled &&
      taskbar &&
      raw.desktopSurfaceDisabled,
    candidateAccountScoped: raw.candidateAccountScoped,
    lastVerifiedAt: raw.lastVerifiedAt,
  }
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
export async function scanNavigationViolations(): Promise<NavigationScanSummary> {
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
  const [raw, focusState] = await Promise.all([
    invoke<{
      isEnvironmentCompliant: boolean
      violationsCount: number
      violations: {
        targetWindowTitle: string
        targetProcessName: string
        classification: string
        actionTaken: string
        policyRule: string
      }[]
    }>('scan_navigation_violations'),
    inspectWindowFocus(),
  ])
  const now = new Date().toISOString()
  return {
    isEnvironmentCompliant: raw.isEnvironmentCompliant,
    violationsCount: raw.violationsCount,
    focusState,
    violations: raw.violations.map((v) => ({
      violationType: v.classification,
      severity: v.actionTaken === 'RECLAIM_TRIGGERED' ? 'HIGH' : 'WARNING',
      description: `${v.policyRule}: ${v.targetWindowTitle || v.targetProcessName}`,
      targetComponent: v.targetProcessName || 'WindowsShell',
      timestamp: now,
    })),
  }
}

