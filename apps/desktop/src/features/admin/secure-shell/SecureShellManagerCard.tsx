import { invoke, isTauri } from '@tauri-apps/api/core'
import { useEffect, useState, type ReactNode } from 'react'
import {
  AlertIcon,
  CheckIcon,
  LockIcon,
  RefreshIcon,
  SettingsIcon,
  ShieldIcon,
} from '@/components/icons'
import { Button, Card, CardBody, CardHeader, StatusBadge } from '@/components/ui'
import {
  applyKioskConfig,
  checkCrashRecovery,
  enforceFullscreen,
  executeRestoration,
  getDisplayTopology,
  getKioskCapabilities,
  getShellHealth,
  inspectStartup,
  previewKioskConfig,
  previewRestoration,
  registerStartup,
  releaseFullscreen,
  runStartupValidation,
} from './secureShell'
import type {
  CrashRecoveryReport,
  DisplayTopologyReport,
  ExaminationStartupValidationReport,
  KioskCapabilityReport,
  KioskConfigPreview,
  RestorationPreview,
  ShellHealthReport,
  StartupConfigurationReport,
} from './types'

export function SecureShellManagerCard() {
  const [kioskCaps, setKioskCaps] = useState<KioskCapabilityReport | null>(null)
  const [startupConfig, setStartupConfig] = useState<StartupConfigurationReport | null>(null)
  const [displayTopology, setDisplayTopology] = useState<DisplayTopologyReport | null>(null)
  const [validationReport, setValidationReport] = useState<ExaminationStartupValidationReport | null>(null)
  const [crashReport, setCrashReport] = useState<CrashRecoveryReport | null>(null)
  const [healthReport, setHealthReport] = useState<ShellHealthReport | null>(null)
  const [kioskPreview, setKioskPreview] = useState<KioskConfigPreview | null>(null)
  const [restorationPreview, setRestorationPreview] = useState<RestorationPreview | null>(null)

  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [adminApprovedKiosk, setAdminApprovedKiosk] = useState(false)
  const [adminApprovedRestore, setAdminApprovedRestore] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeSubTab, setActiveSubTab] = useState<'kiosk' | 'startup' | 'display' | 'validation' | 'recovery' | 'restoration'>('kiosk')

  async function refreshAll() {
    setLoading(true)
    setError(null)
    setActionMessage(null)
    try {
      if (isTauri()) {
        await invoke('secure_shell_heartbeat').catch(() => undefined)
      }
      const [caps, startup, display, validation, crash, health, kPreview, rPreview] = await Promise.all([
        getKioskCapabilities(),
        inspectStartup('AssessXCandidate'),
        getDisplayTopology(),
        runStartupValidation('AssessXCandidate'),
        checkCrashRecovery(),
        getShellHealth(),
        previewKioskConfig('AssessXCandidate', 'ASSIGNED_ACCESS'),
        previewRestoration('AssessXCandidate'),
      ])
      setKioskCaps(caps)
      setStartupConfig(startup)
      setDisplayTopology(display)
      setValidationReport(validation)
      setCrashReport(crash)
      setHealthReport(health)
      setKioskPreview(kPreview)
      setRestorationPreview(rPreview)
    } catch {
      setError('Failed to refresh secure shell and kiosk diagnostics.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  async function handleApplyKiosk() {
    if (!adminApprovedKiosk) return
    setActionLoading(true)
    setError(null)
    try {
      const res = await applyKioskConfig('AssessXCandidate', kioskCaps?.recommendedMechanism ?? 'ASSIGNED_ACCESS', undefined, true)
      if (res.success) {
        setActionMessage(res.message)
      } else {
        setError(res.message)
      }
      await refreshAll()
    } catch {
      setError('Kiosk application encountered an error.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleToggleStartup(enable: boolean) {
    setActionLoading(true)
    setError(null)
    try {
      const res = await registerStartup('AssessXCandidate', enable)
      if (res.success) {
        setActionMessage(res.message)
      } else {
        setError(res.message)
      }
      await refreshAll()
    } catch {
      setError('Failed to update startup registration.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleTestFullscreen() {
    setActionLoading(true)
    try {
      await enforceFullscreen()
      await refreshAll()
    } finally {
      setActionLoading(false)
    }
  }

  async function handleReleaseFullscreen() {
    setActionLoading(true)
    try {
      await releaseFullscreen()
      await refreshAll()
    } finally {
      setActionLoading(false)
    }
  }

  async function handleExecuteRestoration() {
    if (!adminApprovedRestore) return
    setActionLoading(true)
    setError(null)
    try {
      const res = await executeRestoration('AssessXCandidate', true)
      if (res.success) {
        setActionMessage(res.message)
      } else {
        setError(res.message)
      }
      await refreshAll()
    } catch {
      setError('Normal-mode restoration encountered an error.')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Secure Shell & Examination Startup"
        description="Windows Assigned Access, Shell Launcher integration, automatic startup, multi-monitor display manager, and normal-mode restoration (Phase 1B)."
        actions={
          <div className="flex items-center gap-2">
            {healthReport && (
              <StatusBadge
                tone={healthReport.status === 'HEALTHY' ? 'ok' : healthReport.status === 'DEGRADED' ? 'warn' : 'danger'}
                dot
              >
                {healthReport.status}
              </StatusBadge>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refreshAll()}
              disabled={loading}
              leadingIcon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        }
      />

      {/* Sub-tab Navigation */}
      <div className="border-b border-line px-5 flex flex-wrap gap-4 text-[13px] font-medium">
        <button
          type="button"
          onClick={() => setActiveSubTab('kiosk')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeSubTab === 'kiosk'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Kiosk Mechanisms
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('startup')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeSubTab === 'startup'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Automatic Startup
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('display')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeSubTab === 'display'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Display & Fullscreen
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('validation')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeSubTab === 'validation'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Startup Validation
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('recovery')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeSubTab === 'recovery'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Crash Recovery
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab('restoration')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeSubTab === 'restoration'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Normal-Mode Restoration
        </button>
      </div>

      <CardBody className="space-y-5">
        {actionMessage && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-[12.5px] text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
            <CheckIcon className="shrink-0 text-[14px]" />
            <span>{actionMessage}</span>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-[12.5px] text-danger flex items-center gap-2">
            <AlertIcon className="shrink-0 text-[14px]" />
            <span>{error}</span>
          </div>
        )}

        {/* SUB-TAB 1: KIOSK MECHANISMS */}
        {activeSubTab === 'kiosk' && kioskCaps && (
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldIcon className="text-accent text-[15px]" />
                  <h4 className="text-[13.5px] font-semibold text-ink">Windows Kiosk Capability Detection</h4>
                </div>
                <StatusBadge
                  tone={
                    kioskCaps.overallStatus === 'SUPPORTED'
                      ? 'ok'
                      : kioskCaps.overallStatus === 'PARTIALLY_SUPPORTED'
                        ? 'warn'
                        : 'danger'
                  }
                >
                  {kioskCaps.overallStatus}
                </StatusBadge>
              </div>
              <p className="text-[12.5px] text-ink-muted leading-relaxed">
                {kioskCaps.summary}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="rounded-md border border-line/60 bg-surface/30 p-3 text-[12.5px]">
                  <div className="flex items-center justify-between pb-1">
                    <span className="font-semibold text-ink">Assigned Access</span>
                    <StatusBadge tone={kioskCaps.assignedAccess.isSupported ? 'ok' : 'neutral'} className="text-[10.5px]">
                      {kioskCaps.assignedAccess.status}
                    </StatusBadge>
                  </div>
                  <p className="text-[11.5px] text-ink-subtle">{kioskCaps.assignedAccess.details}</p>
                </div>
                <div className="rounded-md border border-line/60 bg-surface/30 p-3 text-[12.5px]">
                  <div className="flex items-center justify-between pb-1">
                    <span className="font-semibold text-ink">Shell Launcher</span>
                    <StatusBadge tone={kioskCaps.shellLauncher.isSupported ? 'ok' : 'neutral'} className="text-[10.5px]">
                      {kioskCaps.shellLauncher.status}
                    </StatusBadge>
                  </div>
                  <p className="text-[11.5px] text-ink-subtle">{kioskCaps.shellLauncher.details}</p>
                </div>
              </div>
            </div>

            {/* Kiosk Configuration Plan & Approval */}
            {kioskPreview && (
              <div className="rounded-lg border border-line bg-surface/40 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13.5px] font-semibold text-ink">Recommended Configuration & Approval Gate</h4>
                  <span className="text-[11px] text-ink-subtle">
                    Target: <strong>{kioskPreview.targetAccount}</strong>
                  </span>
                </div>
                <p className="text-[12px] text-ink-subtle">{kioskPreview.warning}</p>
                <div className="space-y-1.5 text-[11.5px] text-ink-muted bg-card rounded-md border border-line p-3">
                  {kioskPreview.plannedSteps.map((step, idx) => (
                    <div key={idx} className="leading-snug">{step}</div>
                  ))}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                  <label className="flex items-center gap-2 text-[12px] text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={adminApprovedKiosk}
                      onChange={(e) => setAdminApprovedKiosk(e.target.checked)}
                      className="rounded border-line text-accent focus:ring-accent"
                    />
                    <span>I explicitly approve applying kiosk configuration to <strong>{kioskPreview.targetAccount}</strong>.</span>
                  </label>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleApplyKiosk()}
                    disabled={!adminApprovedKiosk || actionLoading}
                    leadingIcon={actionLoading ? <RefreshIcon className="animate-spin" /> : <ShieldIcon />}
                  >
                    Apply Kiosk Mode
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SUB-TAB 2: AUTOMATIC STARTUP */}
        {activeSubTab === 'startup' && startupConfig && (
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[13.5px] font-semibold text-ink">Automatic Examination Startup</h4>
                  <p className="text-[12px] text-ink-subtle">
                    Ensures AssessX launches deterministically upon candidate sign-in.
                  </p>
                </div>
                <StatusBadge tone={startupConfig.isConfigured ? 'ok' : 'neutral'}>
                  {startupConfig.status}
                </StatusBadge>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12.5px] pt-1">
                <MetricItem label="Target Account" value={startupConfig.targetAccount} />
                <MetricItem label="Startup Mechanism" value={startupConfig.startupMechanism} />
                <MetricItem label="Executable Path" value={<span className="font-mono text-[11px] break-all">{startupConfig.executablePath}</span>} />
                <MetricItem label="Binary Exists" value={startupConfig.executableExists ? 'Verified' : 'Missing'} ok={startupConfig.executableExists} />
              </dl>
              <div className="flex justify-end gap-2 pt-2">
                {startupConfig.isConfigured ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleToggleStartup(false)}
                    disabled={actionLoading}
                  >
                    Disable Automatic Startup
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleToggleStartup(true)}
                    disabled={actionLoading}
                  >
                    Register Automatic Startup
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 3: DISPLAY & FULLSCREEN */}
        {activeSubTab === 'display' && displayTopology && (
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[13.5px] font-semibold text-ink">Display Topology & Multi-Monitor Detection</h4>
                  <p className="text-[12px] text-ink-subtle">{displayTopology.message}</p>
                </div>
                <StatusBadge tone={displayTopology.status === 'PASS' ? 'ok' : 'warn'}>
                  {displayTopology.status}
                </StatusBadge>
              </div>
              <div className="space-y-2 pt-1">
                {displayTopology.displays.map((disp) => (
                  <div key={disp.displayId} className="flex items-center justify-between rounded-md border border-line/60 bg-surface/30 p-2.5 text-[12.5px]">
                    <div>
                      <span className="font-medium text-ink">{disp.name}</span>
                      <span className="text-ink-subtle ml-2">({disp.width}x{disp.height} @ {disp.scaleFactor}x)</span>
                    </div>
                    {disp.isPrimary && <StatusBadge tone="neutral" className="text-[10.5px]">Primary</StatusBadge>}
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-[12px] text-ink-subtle">
                  Fullscreen: <strong>{displayTopology.isFullscreen ? 'Active' : 'Windowed'}</strong>
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void handleTestFullscreen()} disabled={actionLoading}>
                    Test Fullscreen Shell
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => void handleReleaseFullscreen()} disabled={actionLoading}>
                    Release Fullscreen
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 4: PRE-FLIGHT STARTUP VALIDATION */}
        {activeSubTab === 'validation' && validationReport && (
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[13.5px] font-semibold text-ink">Examination Pre-Flight Startup Validation</h4>
                  <p className="text-[12px] text-ink-subtle">
                    Evaluates terminal compliance before admitting candidate to an active assessment.
                  </p>
                </div>
                <StatusBadge
                  tone={
                    validationReport.overallResult === 'READY'
                      ? 'ok'
                      : validationReport.overallResult === 'READY_WITH_WARNINGS'
                        ? 'warn'
                        : 'danger'
                  }
                >
                  {validationReport.overallResult}
                </StatusBadge>
              </div>

              <div className="space-y-2 pt-1">
                {validationReport.checks.map((c, i) => (
                  <div key={i} className="flex items-start justify-between rounded-md border border-line/60 bg-surface/30 p-2.5 text-[12.5px] gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-ink">{c.name}</span>
                        {c.blocksStartup && (
                          <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger">BLOCKING</span>
                        )}
                      </div>
                      <p className="text-[11.5px] text-ink-subtle mt-0.5">{c.explanation}</p>
                    </div>
                    <StatusBadge tone={c.status === 'PASS' ? 'ok' : c.status === 'WARNING' ? 'warn' : 'danger'} className="text-[10.5px]">
                      {c.status}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SUB-TAB 5: CRASH RECOVERY */}
        {activeSubTab === 'recovery' && crashReport && (
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[13.5px] font-semibold text-ink">Crash Detection & Bounded Recovery</h4>
                  <p className="text-[12px] text-ink-subtle">{crashReport.message}</p>
                </div>
                <StatusBadge tone={crashReport.crashDetected ? 'warn' : 'ok'}>
                  {crashReport.crashDetected ? 'Crash Detected' : 'Clean State'}
                </StatusBadge>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[12.5px] pt-1">
                <MetricItem label="Restart Attempts" value={`${crashReport.restartCount} of ${crashReport.maxRestartsAllowed}`} />
                <MetricItem label="Escalation Required" value={crashReport.escalationRequired ? 'Yes (Admin Required)' : 'No'} warn={crashReport.escalationRequired} />
                <MetricItem label="Preserved Exam" value={crashReport.preservedAssessmentId ?? 'None'} />
              </dl>
              <p className="text-[11.5px] text-ink-subtle italic">
                * Bounded recovery policy prevents infinite restart loops. If an exam terminal crashes more than 3 times, it automatically locks and requests administrator intervention.
              </p>
            </div>
          </div>
        )}

        {/* SUB-TAB 6: NORMAL-MODE RESTORATION */}
        {activeSubTab === 'restoration' && restorationPreview && (
          <div className="space-y-4">
            <div className="rounded-lg border border-line bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LockIcon className="text-accent text-[15px]" />
                  <h4 className="text-[13.5px] font-semibold text-ink">Administrator-Controlled Normal-Mode Restoration</h4>
                </div>
                <StatusBadge tone={restorationPreview.isAdministrator ? 'ok' : 'danger'}>
                  {restorationPreview.isAdministrator ? 'Administrator Authorized' : 'Standard User'}
                </StatusBadge>
              </div>
              <p className="text-[12.5px] text-ink-muted leading-relaxed">
                Reverts Windows Assigned Access, custom shell launchers, and automatic startup back to default Windows Explorer mode.
              </p>

              <div className="space-y-1.5 text-[11.5px] text-ink-muted bg-surface/40 rounded-md border border-line p-3">
                {restorationPreview.restorationSteps.map((step, idx) => (
                  <div key={idx} className="leading-snug">{step}</div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <label className="flex items-center gap-2 text-[12px] text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={adminApprovedRestore}
                    onChange={(e) => setAdminApprovedRestore(e.target.checked)}
                    className="rounded border-line text-accent focus:ring-accent"
                  />
                  <span>Confirm: Restore workstation to normal Windows desktop operation.</span>
                </label>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleExecuteRestoration()}
                  disabled={!adminApprovedRestore || !restorationPreview.isAdministrator || actionLoading}
                  leadingIcon={actionLoading ? <RefreshIcon className="animate-spin" /> : <SettingsIcon />}
                >
                  Restore Normal Windows Mode
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function MetricItem({
  label,
  value,
  ok,
  warn,
}: {
  label: string
  value: ReactNode
  ok?: boolean
  warn?: boolean
}) {
  return (
    <div className="rounded-md border border-line/60 bg-surface/30 p-2.5">
      <dt className="text-[11px] font-medium text-ink-subtle uppercase tracking-wider">{label}</dt>
      <dd
        className={`mt-0.5 text-[12.5px] font-medium leading-snug break-words ${
          ok
            ? 'text-emerald-700 dark:text-emerald-300'
            : warn
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-ink'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

