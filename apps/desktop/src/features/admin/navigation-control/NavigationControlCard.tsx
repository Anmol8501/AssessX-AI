import { useEffect, useState } from 'react'
import { RefreshIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, StatusBadge } from '@/components/ui'
import {
  applyNavigationPolicy,
  getNavigationPolicy,
  getShortcutCatalog,
  inspectAccessibilityStatus,
  inspectNavigationStatus,
  inspectWindowFocus,
  previewNavigationPolicy,
  rollbackNavigationPolicy,
  scanNavigationViolations,
  validateAndSaveNavigationPolicy,
} from './navigationControl'
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

export function NavigationControlCard() {
  const [shortcuts, setShortcuts] = useState<ShortcutItem[]>([])
  const [policy, setPolicy] = useState<NavigationControlPolicyConfig | null>(null)
  const [navStatus, setNavStatus] = useState<NavigationStatusReport | null>(null)
  const [focusReport, setFocusReport] = useState<WindowFocusReport | null>(null)
  const [accessibilityStatus, setAccessibilityStatus] = useState<AccessibilityStatusReport | null>(null)
  const [preview, setPreview] = useState<PolicyPreviewReport | null>(null)
  const [scanSummary, setScanSummary] = useState<NavigationScanSummary | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'shortcuts' | 'navigation' | 'accessibility' | 'supervisor'>('shortcuts')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')

  // Policy form edits
  const [appSwitching, setAppSwitching] = useState<boolean>(true)
  const [windowsKeys, setWindowsKeys] = useState<boolean>(true)
  const [taskView, setTaskView] = useState<boolean>(true)
  const [screenCapture, setScreenCapture] = useState<boolean>(true)
  const [browserShortcuts, setBrowserShortcuts] = useState<boolean>(true)
  const [taskbarNavigation, setTaskbarNavigation] = useState<boolean>(true)
  const [runDialog, setRunDialog] = useState<boolean>(true)
  const [searchInterface, setSearchInterface] = useState<boolean>(true)
  const [desktopSurface, setDesktopSurface] = useState<boolean>(true)
  const [accessibilityAllowed, setAccessibilityAllowed] = useState<boolean>(true)

  const [confirmApply, setConfirmApply] = useState<boolean>(false)

  const refreshAll = async () => {
    setLoading(true)
    try {
      const [scList, pol, nav, focus, acc] = await Promise.all([
        getShortcutCatalog(),
        getNavigationPolicy(),
        inspectNavigationStatus(),
        inspectWindowFocus(),
        inspectAccessibilityStatus(),
      ])

      setShortcuts(scList)
      setPolicy(pol)
      setNavStatus(nav)
      setFocusReport(focus)
      setAccessibilityStatus(acc)

      setAppSwitching(pol.appSwitchingBlocked)
      setWindowsKeys(pol.windowsKeysBlocked)
      setTaskView(pol.taskViewBlocked)
      setScreenCapture(pol.screenCaptureBlocked)
      setBrowserShortcuts(pol.browserShortcutsBlocked)
      setTaskbarNavigation(pol.taskbarNavigationBlocked)
      setRunDialog(pol.runDialogBlocked)
      setSearchInterface(pol.searchInterfaceBlocked)
      setDesktopSurface(pol.desktopSurfaceBlocked)
      setAccessibilityAllowed(pol.accessibilityAccommodationsAllowed)
    } catch (err) {
      setActionMessage(`Error refreshing navigation control data: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  const handlePreview = async () => {
    if (!policy) return
    const updatedPolicy: NavigationControlPolicyConfig = {
      ...policy,
      appSwitchingBlocked: appSwitching,
      windowsKeysBlocked: windowsKeys,
      taskViewBlocked: taskView,
      screenCaptureBlocked: screenCapture,
      browserShortcutsBlocked: browserShortcuts,
      taskbarNavigationBlocked: taskbarNavigation,
      runDialogBlocked: runDialog,
      searchInterfaceBlocked: searchInterface,
      desktopSurfaceBlocked: desktopSurface,
      accessibilityAccommodationsAllowed: accessibilityAllowed,
    }

    const accConfig: AccessibilityAccommodationConfig = {
      stickyKeysPermitted: accessibilityAllowed,
      filterKeysPermitted: accessibilityAllowed,
      toggleKeysPermitted: accessibilityAllowed,
      highContrastPermitted: accessibilityAllowed,
      screenReaderActive: accessibilityStatus?.screenReaderDetected ?? false,
      magnifierActive: false,
      accommodationNotes: null,
    }

    try {
      const p = await previewNavigationPolicy(updatedPolicy, accConfig)
      setPreview(p)
      setActionMessage('Policy preview generated successfully.')
    } catch (err) {
      setActionMessage(`Preview failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSaveAndValidate = async () => {
    if (!policy) return
    const updatedPolicy: NavigationControlPolicyConfig = {
      ...policy,
      appSwitchingBlocked: appSwitching,
      windowsKeysBlocked: windowsKeys,
      taskViewBlocked: taskView,
      screenCaptureBlocked: screenCapture,
      browserShortcutsBlocked: browserShortcuts,
      taskbarNavigationBlocked: taskbarNavigation,
      runDialogBlocked: runDialog,
      searchInterfaceBlocked: searchInterface,
      desktopSurfaceBlocked: desktopSurface,
      accessibilityAccommodationsAllowed: accessibilityAllowed,
    }

    try {
      const res = await validateAndSaveNavigationPolicy(updatedPolicy)
      if (res.success) {
        setActionMessage('Navigation policy validated and saved to draft state.')
        await refreshAll()
      } else {
        setActionMessage(`Validation error: ${res.error ?? 'Unknown error'}`)
      }
    } catch (err) {
      setActionMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const buildEditedPolicy = (): NavigationControlPolicyConfig | undefined => {
    if (!policy) return undefined
    return {
      ...policy,
      appSwitchingBlocked: appSwitching,
      windowsKeysBlocked: windowsKeys,
      taskViewBlocked: taskView,
      screenCaptureBlocked: screenCapture,
      browserShortcutsBlocked: browserShortcuts,
      taskbarNavigationBlocked: taskbarNavigation,
      runDialogBlocked: runDialog,
      searchInterfaceBlocked: searchInterface,
      desktopSurfaceBlocked: desktopSurface,
      accessibilityAccommodationsAllowed: accessibilityAllowed,
    }
  }

  const handleApply = async () => {
    try {
      const res = await applyNavigationPolicy('ADMIN_SIGNATURE_VERIFIED', buildEditedPolicy())
      if (res.success) {
        setActionMessage('Navigation and keyboard policy actively applied and verified.')
        setConfirmApply(false)
        await refreshAll()
      } else {
        setActionMessage(`Failed to apply policy: ${res.error ?? 'Verification error'}`)
      }
    } catch (err) {
      setActionMessage(`Application failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleRollback = async () => {
    try {
      const res = await rollbackNavigationPolicy()
      if (res.success) {
        setActionMessage('Navigation policy safely rolled back to baseline.')
        await refreshAll()
      }
    } catch (err) {
      setActionMessage(`Rollback failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleScanViolations = async () => {
    try {
      const summary = await scanNavigationViolations()
      setScanSummary(summary)
      setActionMessage(`Violation scan completed: ${summary.violationsCount} violations detected.`)
    } catch (err) {
      setActionMessage(`Scan failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const filteredShortcuts = shortcuts.filter((sc) => {
    const matchesSearch =
      sc.keyCombination.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sc.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sc.targetInterface.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === 'ALL' || sc.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  return (
    <Card>
      <CardHeader
        title="Navigation & Keyboard Shortcut Restrictions"
        description="Phase 2C — Advanced OS-level shortcut interception, Windows Explorer restriction policies, focus monitoring, and accessibility accommodations."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refreshAll()}
              disabled={loading}
              leadingIcon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <CardBody className="space-y-6">
        {actionMessage && (
          <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent-soft px-4 py-2.5 text-xs text-ink">
            <span>{actionMessage}</span>
            <button
              onClick={() => setActionMessage(null)}
              className="ml-3 font-semibold text-accent hover:opacity-80"
            >
              ✕
            </button>
          </div>
        )}

        {/* Global Security Status Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="rounded-lg bg-card-muted/40 p-3.5 border border-line">
            <span className="text-xs text-ink-subtle block mb-1">Policy State</span>
            <div className="flex items-center gap-2">
              <StatusBadge
                tone={
                  policy?.state === 'Active'
                    ? 'ok'
                    : policy?.state === 'Draft' || policy?.state === 'Validated'
                      ? 'warn'
                      : 'neutral'
                }
              >
                {policy?.state ?? 'UNKNOWN'}
              </StatusBadge>
            </div>
          </div>

          <div className="rounded-lg bg-card-muted/40 p-3.5 border border-line">
            <span className="text-xs text-ink-subtle block mb-1">Windows Shell Restrictions</span>
            <div className="flex items-center gap-2">
              <StatusBadge tone={navStatus?.allShellPoliciesEnforced ? 'ok' : 'warn'}>
                {navStatus?.allShellPoliciesEnforced ? 'Enforced' : 'Baseline / Inactive'}
              </StatusBadge>
            </div>
          </div>

          <div className="rounded-lg bg-card-muted/40 p-3.5 border border-line">
            <span className="text-xs text-ink-subtle block mb-1">Foreground Focus</span>
            <div className="flex items-center gap-2">
              <StatusBadge tone={focusReport?.isExamWindowForeground ? 'ok' : 'warn'}>
                {focusReport?.targetClass ?? 'Unknown'}
              </StatusBadge>
            </div>
          </div>

          <div className="rounded-lg bg-card-muted/40 p-3.5 border border-line">
            <span className="text-xs text-ink-subtle block mb-1">Accommodations Active</span>
            <div className="flex items-center gap-2">
              <StatusBadge
                tone={
                  (accessibilityStatus?.accommodationsActiveCount ?? 0) > 0
                    ? 'accent'
                    : 'neutral'
                }
              >
                {accessibilityStatus?.accommodationsActiveCount ?? 0} Accommodations
              </StatusBadge>
            </div>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="border-b border-line flex flex-wrap gap-4 text-[13px] font-medium">
          <button
            onClick={() => setActiveTab('shortcuts')}
            className={`pb-2.5 px-1 border-b-2 transition-colors ${
              activeTab === 'shortcuts'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
          >
            Shortcut Catalog ({shortcuts.length})
          </button>
          <button
            onClick={() => setActiveTab('navigation')}
            className={`pb-2.5 px-1 border-b-2 transition-colors ${
              activeTab === 'navigation'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
          >
            Shell &amp; Navigation Policies
          </button>
          <button
            onClick={() => setActiveTab('accessibility')}
            className={`pb-2.5 px-1 border-b-2 transition-colors ${
              activeTab === 'accessibility'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
          >
            Accommodations &amp; Policy Preview
          </button>
          <button
            onClick={() => setActiveTab('supervisor')}
            className={`pb-2.5 px-1 border-b-2 transition-colors ${
              activeTab === 'supervisor'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
          >
            Focus Supervisor &amp; Violations
          </button>
        </div>

        {/* TAB 1: SHORTCUT CATALOG */}
        {activeTab === 'shortcuts' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <input
                type="text"
                placeholder="Search key combo, interface, description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full sm:w-80 rounded-md bg-surface border border-line px-3 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent"
              />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full sm:w-auto rounded-md bg-surface border border-line px-3 py-1.5 text-xs text-ink focus:outline-none focus:border-accent"
              >
                <option value="ALL">All Categories</option>
                <option value="ApplicationSwitching">Application Switching</option>
                <option value="ShellAndDesktopNavigation">Shell &amp; Desktop Navigation</option>
                <option value="TaskAndSessionControl">Task &amp; Session Control</option>
                <option value="BrowserAndApplicationShortcuts">Browser / App Shortcuts</option>
                <option value="ClipboardAndContent">Clipboard &amp; Content</option>
                <option value="PrintAndScreenCapture">Print &amp; Screen Capture</option>
                <option value="AccessibilityAndSpecialKeys">Accessibility &amp; Special Keys</option>
              </select>
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-left text-xs text-ink-muted">
                <thead className="bg-card-muted/60 text-ink-subtle uppercase tracking-wider border-b border-line">
                  <tr>
                    <th className="py-2.5 px-3">Combination</th>
                    <th className="py-2.5 px-3">Target Interface</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Risk Level</th>
                    <th className="py-2.5 px-3">Default Action</th>
                    <th className="py-2.5 px-3">Enforcement</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-surface">
                  {filteredShortcuts.map((sc) => (
                    <tr key={sc.id} className="hover:bg-card-muted/40">
                      <td className="py-2.5 px-3 font-mono font-bold text-ink">
                        {sc.keyCombination}
                      </td>
                      <td className="py-2.5 px-3 text-ink">{sc.targetInterface}</td>
                      <td className="py-2.5 px-3 text-ink-subtle">{sc.category}</td>
                      <td className="py-2.5 px-3">
                        <StatusBadge
                          tone={
                            sc.riskLevel === 'CriticalAttention'
                              ? 'danger'
                              : sc.riskLevel === 'Severe'
                                ? 'danger'
                                : sc.riskLevel === 'HighRisk'
                                  ? 'warn'
                                  : 'neutral'
                          }
                        >
                          {sc.riskLevel}
                        </StatusBadge>
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusBadge
                          tone={
                            sc.defaultAction === 'Block'
                              ? 'danger'
                              : sc.defaultAction === 'KernelRestricted'
                                ? 'warn'
                                : 'ok'
                          }
                        >
                          {sc.defaultAction}
                        </StatusBadge>
                      </td>
                      <td className="py-2.5 px-3 text-ink-subtle">{sc.enforcementType}</td>
                    </tr>
                  ))}
                  {filteredShortcuts.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-ink-subtle">
                        No shortcuts matched your search filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-ink-subtle italic">
              Note: Key combinations classified as <strong className="text-amber-600 dark:text-amber-400">KernelRestricted</strong> (e.g. Ctrl+Alt+Del, Win+L)
              are processed by the Windows Winlogon kernel boundary and cannot be intercepted by userland hooks. AssessX monitors them via focus loss detection.
            </p>
          </div>
        )}

        {/* TAB 2: SHELL & NAVIGATION POLICIES */}
        {activeTab === 'navigation' && (
          <div className="space-y-5">
            <div className="rounded-lg bg-card-muted/30 p-4 border border-line space-y-4">
              <h4 className="text-xs font-semibold text-ink uppercase tracking-wider">
                Registry &amp; Shell Restriction Toggles
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex items-center gap-3 p-2.5 rounded bg-surface border border-line cursor-pointer">
                  <input
                    type="checkbox"
                    checked={windowsKeys}
                    onChange={(e) => setWindowsKeys(e.target.checked)}
                    className="rounded border-line text-accent focus:ring-0"
                  />
                  <div>
                    <span className="text-xs font-medium text-ink block">Block Windows Keys (NoWinKeys)</span>
                    <span className="text-[11px] text-ink-subtle">Suppresses all Win+ hotkeys at the Explorer shell</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-2.5 rounded bg-surface border border-line cursor-pointer">
                  <input
                    type="checkbox"
                    checked={runDialog}
                    onChange={(e) => setRunDialog(e.target.checked)}
                    className="rounded border-line text-accent focus:ring-0"
                  />
                  <div>
                    <span className="text-xs font-medium text-ink block">Block Run Dialog (NoRun)</span>
                    <span className="text-[11px] text-ink-subtle">Prevents execution prompts and Start menu run</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-2.5 rounded bg-surface border border-line cursor-pointer">
                  <input
                    type="checkbox"
                    checked={searchInterface}
                    onChange={(e) => setSearchInterface(e.target.checked)}
                    className="rounded border-line text-accent focus:ring-0"
                  />
                  <div>
                    <span className="text-xs font-medium text-ink block">Block Search Interface (NoFind)</span>
                    <span className="text-[11px] text-ink-subtle">Disables Windows search and file indexing flyouts</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-2.5 rounded bg-surface border border-line cursor-pointer">
                  <input
                    type="checkbox"
                    checked={desktopSurface}
                    onChange={(e) => setDesktopSurface(e.target.checked)}
                    className="rounded border-line text-accent focus:ring-0"
                  />
                  <div>
                    <span className="text-xs font-medium text-ink block">Block Desktop Surface (NoDesktop)</span>
                    <span className="text-[11px] text-ink-subtle">Hides desktop icons and disables desktop clicks</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-2.5 rounded bg-surface border border-line cursor-pointer">
                  <input
                    type="checkbox"
                    checked={taskbarNavigation}
                    onChange={(e) => setTaskbarNavigation(e.target.checked)}
                    className="rounded border-line text-accent focus:ring-0"
                  />
                  <div>
                    <span className="text-xs font-medium text-ink block">Lock Taskbar &amp; Tray Menu</span>
                    <span className="text-[11px] text-ink-subtle">Sets NoTrayContextMenu and NoSetTaskbar</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-2.5 rounded bg-surface border border-line cursor-pointer">
                  <input
                    type="checkbox"
                    checked={appSwitching}
                    onChange={(e) => setAppSwitching(e.target.checked)}
                    className="rounded border-line text-accent focus:ring-0"
                  />
                  <div>
                    <span className="text-xs font-medium text-ink block">Block App Switching (Alt+Tab)</span>
                    <span className="text-[11px] text-ink-subtle">Suppresses task switcher and window cycling</span>
                  </div>
                </label>
              </div>

              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={() => void handleSaveAndValidate()}
                  variant="secondary"
                >
                  Validate Policy
                </Button>
                <Button
                  size="sm"
                  onClick={() => setConfirmApply(true)}
                >
                  Apply &amp; Verify Restrictions
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void handleRollback()}
                >
                  Rollback to Baseline
                </Button>
              </div>
            </div>

            {confirmApply && (
              <div className="rounded-lg border border-warn/40 bg-warn/10 p-4 space-y-3">
                <h5 className="text-xs font-semibold text-ink uppercase">
                  Administrator Approval Required
                </h5>
                <p className="text-xs text-ink-muted">
                  Applying these policies will write Windows Explorer restriction policies to the user registry.
                  Ensure you are scoped to candidate profiles during live examinations.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleApply()}
                  >
                    Confirm &amp; Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmApply(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: ACCESSIBILITY & POLICY PREVIEW */}
        {activeTab === 'accessibility' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-card-muted/30 p-4 border border-line space-y-3">
              <h4 className="text-xs font-semibold text-ink uppercase tracking-wider">
                Accessibility Accommodations
              </h4>
              <p className="text-xs text-ink-muted">
                Institutional examination regulations mandate that accommodations (e.g. StickyKeys, FilterKeys, Screen Readers)
                must be preserved for authorized candidates unless an institutional waiver is explicitly granted.
              </p>

              <label className="flex items-center gap-3 p-3 rounded bg-surface border border-line cursor-pointer">
                <input
                  type="checkbox"
                  checked={accessibilityAllowed}
                  onChange={(e) => setAccessibilityAllowed(e.target.checked)}
                  className="rounded border-line text-accent focus:ring-0"
                />
                <div>
                  <span className="text-xs font-semibold text-ink block">
                    Permit Approved Accessibility Accommodations
                  </span>
                  <span className="text-[11px] text-ink-subtle">
                    Guarantees StickyKeys, FilterKeys, High Contrast, and Screen Reader shortcuts remain unblocked.
                  </span>
                </div>
              </label>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-xs">
                <div className="p-2.5 rounded bg-surface border border-line">
                  <span className="text-ink-subtle block text-[11px]">Sticky Keys</span>
                  <span className="font-semibold text-ink">
                    {accessibilityStatus?.stickyKeysDetected ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="p-2.5 rounded bg-surface border border-line">
                  <span className="text-ink-subtle block text-[11px]">Filter Keys</span>
                  <span className="font-semibold text-ink">
                    {accessibilityStatus?.filterKeysDetected ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="p-2.5 rounded bg-surface border border-line">
                  <span className="text-ink-subtle block text-[11px]">High Contrast</span>
                  <span className="font-semibold text-ink">
                    {accessibilityStatus?.highContrastDetected ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="p-2.5 rounded bg-surface border border-line">
                  <span className="text-ink-subtle block text-[11px]">Screen Reader</span>
                  <span className="font-semibold text-ink">
                    {accessibilityStatus?.screenReaderDetected ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  size="sm"
                  onClick={() => void handlePreview()}
                >
                  Generate Policy Impact Preview
                </Button>
              </div>
            </div>

            {preview && (
              <div className="rounded-lg bg-card-muted/30 p-4 border border-line space-y-3">
                <h5 className="text-xs font-semibold text-ink uppercase">Policy Impact Analysis</h5>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2 bg-surface border border-line rounded">
                    <span className="text-ink-subtle text-[11px] block">Shortcuts Covered</span>
                    <span className="font-bold text-ink">{preview.totalShortcutsCovered}</span>
                  </div>
                  <div className="p-2 bg-surface border border-line rounded">
                    <span className="text-ink-subtle text-[11px] block">Blocked</span>
                    <span className="font-bold text-danger">{preview.blockedCount}</span>
                  </div>
                  <div className="p-2 bg-surface border border-line rounded">
                    <span className="text-ink-subtle text-[11px] block">Permitted</span>
                    <span className="font-bold text-ok">{preview.allowedCount}</span>
                  </div>
                  <div className="p-2 bg-surface border border-line rounded">
                    <span className="text-ink-subtle text-[11px] block">Kernel Restricted</span>
                    <span className="font-bold text-amber-600">{preview.kernelRestrictedCount}</span>
                  </div>
                </div>

                {preview.conflicts.length > 0 && (
                  <div className="p-3 rounded bg-danger/10 border border-danger/30 text-xs text-danger">
                    <strong className="block mb-1">Policy Conflicts / Notices:</strong>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {preview.conflicts.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SUPERVISOR & VIOLATIONS */}
        {activeTab === 'supervisor' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-card-muted/30 p-4 border border-line space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-ink uppercase tracking-wider">
                  Foreground Window Supervisor
                </h4>
                <Button
                  size="sm"
                  onClick={() => void handleScanViolations()}
                >
                  Run Violation Scan
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded bg-surface border border-line space-y-1">
                  <span className="text-ink-subtle text-[11px] block">Active Window Title</span>
                  <span className="font-mono text-ink font-bold block truncate">
                    {focusReport?.activeForegroundTitle || '(None)'}
                  </span>
                </div>
                <div className="p-3 rounded bg-surface border border-line space-y-1">
                  <span className="text-ink-subtle text-[11px] block">Active Process</span>
                  <span className="font-mono text-ink font-bold block truncate">
                    {focusReport?.activeForegroundProcess || '(Unknown)'}
                  </span>
                </div>
                <div className="p-3 rounded bg-surface border border-line space-y-1">
                  <span className="text-ink-subtle text-[11px] block">Window Class</span>
                  <span className="font-mono text-ink block truncate">
                    {focusReport?.activeForegroundClass || '(Unknown)'}
                  </span>
                </div>
                <div className="p-3 rounded bg-surface border border-line space-y-1">
                  <span className="text-ink-subtle text-[11px] block">Cumulative Focus Losses</span>
                  <span className="font-bold text-amber-600">
                    {focusReport?.lossOfFocusCount ?? 0} events
                  </span>
                </div>
              </div>
            </div>

            {scanSummary && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-semibold text-ink uppercase">
                    Detected Violations ({scanSummary.violationsCount})
                  </h5>
                  <StatusBadge tone={scanSummary.isEnvironmentCompliant ? 'ok' : 'danger'}>
                    {scanSummary.isEnvironmentCompliant ? 'Compliant' : 'Non-Compliant'}
                  </StatusBadge>
                </div>

                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-xs text-ink-muted">
                    <thead className="bg-card-muted/60 text-ink-subtle uppercase tracking-wider border-b border-line">
                      <tr>
                        <th className="py-2.5 px-3">Type</th>
                        <th className="py-2.5 px-3">Severity</th>
                        <th className="py-2.5 px-3">Target</th>
                        <th className="py-2.5 px-3">Description</th>
                        <th className="py-2.5 px-3">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line bg-surface">
                      {scanSummary.violations.map((v, i) => (
                        <tr key={i} className="hover:bg-card-muted/40">
                          <td className="py-2.5 px-3 font-semibold text-danger">{v.violationType}</td>
                          <td className="py-2.5 px-3">
                            <StatusBadge tone="danger">{v.severity}</StatusBadge>
                          </td>
                          <td className="py-2.5 px-3 font-mono">{v.targetComponent}</td>
                          <td className="py-2.5 px-3 text-ink">{v.description}</td>
                          <td className="py-2.5 px-3 text-ink-subtle font-mono text-[11px]">{v.timestamp}</td>
                        </tr>
                      ))}
                      {scanSummary.violations.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-ok">
                            No active navigation or focus violations detected.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
