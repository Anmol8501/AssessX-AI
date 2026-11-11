import { useEffect, useState } from 'react'
import { RefreshIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, StatusBadge } from '@/components/ui'
import {
  applyPeripheralPolicy,
  getPeripheralPolicy,
  inspectDisplayTopology,
  inspectRemoteAccessStatus,
  inspectStorageStatus,
  previewPeripheralPolicy,
  rollbackPeripheralPolicy,
  scanPeripheralViolations,
  validateAndSavePeripheralPolicy,
} from './peripheralControl'
import type {
  DisplayTopologyReport,
  PeripheralPolicyConfig,
  PeripheralPolicyPreviewReport,
  PeripheralScanSummary,
  RemoteAccessStatusReport,
  StoragePolicyMode,
  StorageStatusReport,
} from './types'

export function PeripheralControlCard() {
  const [storageReport, setStorageReport] = useState<StorageStatusReport | null>(null)
  const [displayReport, setDisplayReport] = useState<DisplayTopologyReport | null>(null)
  const [remoteReport, setRemoteReport] = useState<RemoteAccessStatusReport | null>(null)
  const [policy, setPolicy] = useState<PeripheralPolicyConfig | null>(null)
  const [preview, setPreview] = useState<PeripheralPolicyPreviewReport | null>(null)
  const [scanSummary, setScanSummary] = useState<PeripheralScanSummary | null>(null)

  const [loading, setLoading] = useState<boolean>(true)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'storage' | 'display' | 'remote' | 'lifecycle'>('storage')

  // Policy form edits
  const [storageMode, setStorageMode] = useState<StoragePolicyMode>('AuditOnly')
  const [maxMonitors, setMaxMonitors] = useState<number>(1)
  const [allowVirtualDisplays, setAllowVirtualDisplays] = useState<boolean>(false)
  const [blockRemoteSessions, setBlockRemoteSessions] = useState<boolean>(true)
  const [blockRemoteTools, setBlockRemoteTools] = useState<boolean>(true)
  const [requireCamera, setRequireCamera] = useState<boolean>(true)
  const [requireMicrophone, setRequireMicrophone] = useState<boolean>(true)

  const [confirmApply, setConfirmApply] = useState<boolean>(false)

  const refreshAll = async () => {
    setLoading(true)
    try {
      const [storage, display, remote, pol] = await Promise.all([
        inspectStorageStatus(),
        inspectDisplayTopology(),
        inspectRemoteAccessStatus(),
        getPeripheralPolicy(),
      ])

      setStorageReport(storage)
      setDisplayReport(display)
      setRemoteReport(remote)
      setPolicy(pol)

      setStorageMode(pol.storageMode)
      setMaxMonitors(pol.maxMonitors)
      setAllowVirtualDisplays(pol.allowVirtualDisplays)
      setBlockRemoteSessions(pol.blockRemoteSessions)
      setBlockRemoteTools(pol.blockRemoteTools)
      setRequireCamera(pol.requireCamera)
      setRequireMicrophone(pol.requireMicrophone)
    } catch (err) {
      setActionMessage(`Error refreshing peripheral data: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  const handlePreview = async () => {
    if (!policy) return
    const updatedPolicy: PeripheralPolicyConfig = {
      ...policy,
      storageMode,
      maxMonitors,
      allowVirtualDisplays,
      blockRemoteSessions,
      blockRemoteTools,
      requireCamera,
      requireMicrophone,
    }

    try {
      const p = await previewPeripheralPolicy(updatedPolicy)
      setPreview(p)
      setActionMessage('Policy preview generated successfully.')
    } catch (err) {
      setActionMessage(`Preview failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleSaveAndValidate = async () => {
    if (!policy) return
    const updatedPolicy: PeripheralPolicyConfig = {
      ...policy,
      storageMode,
      maxMonitors,
      allowVirtualDisplays,
      blockRemoteSessions,
      blockRemoteTools,
      requireCamera,
      requireMicrophone,
    }

    try {
      const res = await validateAndSavePeripheralPolicy(updatedPolicy)
      if (res.success) {
        setActionMessage('Peripheral policy validated and saved.')
        await refreshAll()
      } else {
        setActionMessage(`Validation error: ${res.error ?? 'Unknown error'}`)
      }
    } catch (err) {
      setActionMessage(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleApply = async () => {
    try {
      const res = await applyPeripheralPolicy('ADMIN_SIGNATURE_VERIFIED')
      if (res.success) {
        setActionMessage('Peripheral and remote restrictions actively applied.')
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
      const res = await rollbackPeripheralPolicy()
      if (res.success) {
        setActionMessage('Peripheral policy safely rolled back to baseline.')
        await refreshAll()
      }
    } catch (err) {
      setActionMessage(`Rollback failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleScanViolations = async () => {
    try {
      const summary = await scanPeripheralViolations()
      setScanSummary(summary)
      setActionMessage(`Peripheral scan completed: ${summary.violationsCount} violations detected.`)
    } catch (err) {
      setActionMessage(`Scan failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <Card>
      <CardHeader
        title="USB Storage, Display Topology & Remote Access Control"
        description="Phase 2D — Enforces removable storage restrictions, single/multi-display topologies, peripheral health, and prevents unauthorized remote desktop access."
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
            <span className="text-xs text-ink-subtle block mb-1">USB Storage Mode</span>
            <div className="flex items-center gap-2">
              <StatusBadge
                tone={
                  policy?.storageMode === 'BlockUnapprovedStorage'
                    ? 'danger'
                    : policy?.storageMode === 'AllowApprovedDevices'
                      ? 'warn'
                      : 'neutral'
                }
              >
                {policy?.storageMode ?? 'UNKNOWN'}
              </StatusBadge>
            </div>
          </div>

          <div className="rounded-lg bg-card-muted/40 p-3.5 border border-line">
            <span className="text-xs text-ink-subtle block mb-1">Display Topology</span>
            <div className="flex items-center gap-2">
              <StatusBadge tone={displayReport?.isTopologyCompliant ? 'ok' : 'danger'}>
                {displayReport?.monitorCount ?? 0} Monitor(s) {displayReport?.hasVirtualDisplay ? '(Virtual)' : ''}
              </StatusBadge>
            </div>
          </div>

          <div className="rounded-lg bg-card-muted/40 p-3.5 border border-line">
            <span className="text-xs text-ink-subtle block mb-1">Remote Access State</span>
            <div className="flex items-center gap-2">
              <StatusBadge tone={remoteReport?.isEnvironmentSecure ? 'ok' : 'danger'}>
                {remoteReport?.classification ?? 'UNKNOWN'}
              </StatusBadge>
            </div>
          </div>

          <div className="rounded-lg bg-card-muted/40 p-3.5 border border-line">
            <span className="text-xs text-ink-subtle block mb-1">Peripherals Ready</span>
            <div className="flex items-center gap-2">
              <StatusBadge tone={displayReport?.peripherals.allRequiredPeripheralsReady ? 'ok' : 'warn'}>
                {displayReport?.peripherals.allRequiredPeripheralsReady ? 'All Functional' : 'Attention Needed'}
              </StatusBadge>
            </div>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="border-b border-line flex flex-wrap gap-4 text-[13px] font-medium">
          <button
            onClick={() => setActiveTab('storage')}
            className={`pb-2.5 px-1 border-b-2 transition-colors ${
              activeTab === 'storage'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
          >
            USB Storage Control
          </button>
          <button
            onClick={() => setActiveTab('display')}
            className={`pb-2.5 px-1 border-b-2 transition-colors ${
              activeTab === 'display'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
          >
            Display &amp; Peripherals
          </button>
          <button
            onClick={() => setActiveTab('remote')}
            className={`pb-2.5 px-1 border-b-2 transition-colors ${
              activeTab === 'remote'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
          >
            Remote Access &amp; Tools
          </button>
          <button
            onClick={() => setActiveTab('lifecycle')}
            className={`pb-2.5 px-1 border-b-2 transition-colors ${
              activeTab === 'lifecycle'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
          >
            Policy Lifecycle &amp; Violations
          </button>
        </div>

        {/* TAB 1: USB STORAGE CONTROL */}
        {activeTab === 'storage' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-card-muted/30 p-4 border border-line space-y-4">
              <h4 className="text-xs font-semibold text-ink uppercase tracking-wider">
                Removable Storage Policy Configuration
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded bg-surface border border-line">
                  <span className="text-ink-subtle block mb-1">Select Storage Policy Mode</span>
                  <select
                    value={storageMode}
                    onChange={(e) => setStorageMode(e.target.value as StoragePolicyMode)}
                    className="w-full rounded bg-surface border border-line px-3 py-1.5 text-ink focus:outline-none focus:border-accent"
                  >
                    <option value="AuditOnly">Audit Only (Monitor &amp; Log)</option>
                    <option value="BlockUnapprovedStorage">Block Unapproved Storage (Enforce Deny_All)</option>
                    <option value="AllowApprovedDevices">Allow Approved Devices Only</option>
                    <option value="AllowAllSupported">Allow All (Non-Exam Baseline)</option>
                  </select>
                </div>

                <div className="p-3 rounded bg-surface border border-line space-y-1">
                  <span className="text-ink-subtle block">Registry Policy Status</span>
                  <span className="font-mono text-ink block">
                    Deny_All Value: {storageReport?.removableStorageDenyAllPolicy ? '1 (Active)' : '0 (Permitted)'}
                  </span>
                  <span className="font-mono text-ink-subtle block text-[11px]">
                    USBSTOR Start Value: {storageReport?.usbstorServiceStart ?? 3}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-ink uppercase">
                  Connected Removable Storage Devices ({storageReport?.connectedRemovableDrivesCount ?? 0})
                </h5>

                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-xs text-ink-muted">
                    <thead className="bg-card-muted/60 text-ink-subtle uppercase tracking-wider border-b border-line">
                      <tr>
                        <th className="py-2.5 px-3">Drive Letter</th>
                        <th className="py-2.5 px-3">Volume Label</th>
                        <th className="py-2.5 px-3">File System</th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line bg-surface">
                      {storageReport?.removableDrives.map((d, i) => (
                        <tr key={i} className="hover:bg-card-muted/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-ink">{d.driveLetter}</td>
                          <td className="py-2.5 px-3 text-ink">{d.volumeName}</td>
                          <td className="py-2.5 px-3 text-ink-subtle">{d.fileSystem}</td>
                          <td className="py-2.5 px-3">
                            <StatusBadge tone={d.isBlocked ? 'danger' : 'neutral'}>
                              {d.isBlocked ? 'Blocked' : 'Accessible'}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                      {(storageReport?.removableDrives.length ?? 0) === 0 && (
                        <tr>
                          <td colSpan={4} className="py-6 text-center text-ink-subtle">
                            No removable USB storage devices currently connected.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-[11px] text-ink-subtle italic">
                Safety Safeguard: Keyboards, mice, and accessibility hardware connect via HID class and are strictly preserved regardless of storage policy.
              </p>
            </div>
          </div>
        )}

        {/* TAB 2: DISPLAY & PERIPHERALS */}
        {activeTab === 'display' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-card-muted/30 p-4 border border-line space-y-4">
              <h4 className="text-xs font-semibold text-ink uppercase tracking-wider">
                Display Topology &amp; Peripheral Readiness
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded bg-surface border border-line">
                  <span className="text-ink-subtle block mb-1">Max Permitted Displays</span>
                  <select
                    value={maxMonitors}
                    onChange={(e) => setMaxMonitors(parseInt(e.target.value, 10))}
                    className="w-full rounded bg-surface border border-line px-3 py-1.5 text-ink focus:outline-none focus:border-accent"
                  >
                    <option value={1}>1 Monitor (Single Screen Standard)</option>
                    <option value={2}>2 Monitors (Approved Dual Setup)</option>
                  </select>
                </div>

                <div className="p-3 rounded bg-surface border border-line space-y-1">
                  <span className="text-ink-subtle block">Primary Display Resolution</span>
                  <span className="font-mono text-ink font-bold block">
                    {displayReport?.primaryWidth ?? 0} x {displayReport?.primaryHeight ?? 0}
                  </span>
                  <span className="text-ink-subtle block text-[11px]">
                    Virtual Bounds: {displayReport?.virtualScreenWidth ?? 0} x {displayReport?.virtualScreenHeight ?? 0}
                  </span>
                </div>

                <div className="p-3 rounded bg-surface border border-line space-y-1">
                  <span className="text-ink-subtle block">Virtual Display Adapter</span>
                  <StatusBadge tone={displayReport?.hasVirtualDisplay ? 'danger' : 'ok'}>
                    {displayReport?.hasVirtualDisplay ? 'Virtual Adapter Detected' : 'No Virtual Adapter'}
                  </StatusBadge>
                </div>
              </div>

              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-ink uppercase">
                  Connected Displays ({displayReport?.monitors.length ?? 0})
                </h5>

                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-xs text-ink-muted">
                    <thead className="bg-card-muted/60 text-ink-subtle uppercase tracking-wider border-b border-line">
                      <tr>
                        <th className="py-2.5 px-3">Device Name</th>
                        <th className="py-2.5 px-3">Resolution</th>
                        <th className="py-2.5 px-3">Primary</th>
                        <th className="py-2.5 px-3">Adapter Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line bg-surface">
                      {displayReport?.monitors.map((m) => (
                        <tr key={m.monitorId} className="hover:bg-card-muted/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-ink">{m.deviceName}</td>
                          <td className="py-2.5 px-3 text-ink">{m.width} x {m.height}</td>
                          <td className="py-2.5 px-3">
                            <StatusBadge tone={m.isPrimary ? 'accent' : 'neutral'}>
                              {m.isPrimary ? 'Primary' : 'Secondary'}
                            </StatusBadge>
                          </td>
                          <td className="py-2.5 px-3">
                            <StatusBadge tone={m.isVirtualDisplay ? 'danger' : 'ok'}>
                              {m.isVirtualDisplay ? 'Virtual / Software' : 'Physical Display'}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <h5 className="text-xs font-semibold text-ink uppercase">Required Peripheral Readiness</h5>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2.5 rounded bg-surface border border-line flex justify-between items-center">
                    <span className="text-ink-subtle">Webcam</span>
                    <StatusBadge tone={displayReport?.peripherals.cameraDetected ? 'ok' : 'danger'}>
                      {displayReport?.peripherals.cameraDetected ? 'Ready' : 'Missing'}
                    </StatusBadge>
                  </div>
                  <div className="p-2.5 rounded bg-surface border border-line flex justify-between items-center">
                    <span className="text-ink-subtle">Microphone</span>
                    <StatusBadge tone={displayReport?.peripherals.microphoneDetected ? 'ok' : 'danger'}>
                      {displayReport?.peripherals.microphoneDetected ? 'Ready' : 'Missing'}
                    </StatusBadge>
                  </div>
                  <div className="p-2.5 rounded bg-surface border border-line flex justify-between items-center">
                    <span className="text-ink-subtle">Keyboard</span>
                    <StatusBadge tone={displayReport?.peripherals.keyboardDetected ? 'ok' : 'danger'}>
                      {displayReport?.peripherals.keyboardDetected ? 'Ready' : 'Missing'}
                    </StatusBadge>
                  </div>
                  <div className="p-2.5 rounded bg-surface border border-line flex justify-between items-center">
                    <span className="text-ink-subtle">Mouse</span>
                    <StatusBadge tone={displayReport?.peripherals.mouseDetected ? 'ok' : 'danger'}>
                      {displayReport?.peripherals.mouseDetected ? 'Ready' : 'Missing'}
                    </StatusBadge>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: REMOTE ACCESS & TOOLS */}
        {activeTab === 'remote' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-card-muted/30 p-4 border border-line space-y-4">
              <h4 className="text-xs font-semibold text-ink uppercase tracking-wider">
                Remote Desktop &amp; Screen-Sharing Inspection
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded bg-surface border border-line space-y-1">
                  <span className="text-ink-subtle block">Active Remote Session (SM_REMOTESESSION)</span>
                  <StatusBadge tone={remoteReport?.isRemoteSessionActive ? 'danger' : 'ok'}>
                    {remoteReport?.isRemoteSessionActive ? 'Active Remote Desktop Session' : 'Direct Console Session'}
                  </StatusBadge>
                </div>

                <div className="p-3 rounded bg-surface border border-line space-y-1">
                  <span className="text-ink-subtle block">Windows Terminal Server Policy</span>
                  <StatusBadge tone={remoteReport?.rdpDeniedByPolicy ? 'ok' : 'warn'}>
                    {remoteReport?.rdpDeniedByPolicy ? 'RDP Disabled (fDenyTSConnections=1)' : 'RDP Allowed'}
                  </StatusBadge>
                </div>
              </div>

              <div className="space-y-2">
                <h5 className="text-xs font-semibold text-ink uppercase">
                  Detected Remote Assistance &amp; Control Software ({remoteReport?.runningRemoteToolsCount ?? 0})
                </h5>

                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full text-left text-xs text-ink-muted">
                    <thead className="bg-card-muted/60 text-ink-subtle uppercase tracking-wider border-b border-line">
                      <tr>
                        <th className="py-2.5 px-3">Tool Name</th>
                        <th className="py-2.5 px-3">Executable</th>
                        <th className="py-2.5 px-3">PID</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line bg-surface">
                      {remoteReport?.detectedRemoteTools.map((t, i) => (
                        <tr key={i} className="hover:bg-card-muted/40">
                          <td className="py-2.5 px-3 font-semibold text-danger">{t.toolName}</td>
                          <td className="py-2.5 px-3 font-mono text-ink">{t.executableName}</td>
                          <td className="py-2.5 px-3 font-mono">{t.processId}</td>
                          <td className="py-2.5 px-3 text-ink-subtle">{t.category}</td>
                          <td className="py-2.5 px-3">
                            <StatusBadge tone="danger">Running</StatusBadge>
                          </td>
                        </tr>
                      ))}
                      {(remoteReport?.detectedRemoteTools.length ?? 0) === 0 && (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-ok">
                            No prohibited remote assistance or screen-sharing software running.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: POLICY LIFECYCLE & VIOLATIONS */}
        {activeTab === 'lifecycle' && (
          <div className="space-y-4">
            <div className="rounded-lg bg-card-muted/30 p-4 border border-line space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold text-ink uppercase tracking-wider">
                  Peripheral Policy Lifecycle Operations
                </h4>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handlePreview()}
                  >
                    Preview Impact
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleSaveAndValidate()}
                  >
                    Validate Policy
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setConfirmApply(true)}
                  >
                    Apply Policy
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
                    Applying peripheral restrictions will enforce USB storage blocking and active display topology enforcement.
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

              {preview && (
                <div className="rounded-lg bg-surface p-4 border border-line space-y-3">
                  <h5 className="text-xs font-semibold text-ink uppercase">Impact Analysis</h5>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="p-2 bg-card-muted/40 border border-line rounded">
                      <span className="text-ink-subtle text-[11px] block">Storage Mode</span>
                      <span className="font-bold text-ink">{preview.storageImpactMode}</span>
                    </div>
                    <div className="p-2 bg-card-muted/40 border border-line rounded">
                      <span className="text-ink-subtle text-[11px] block">Drives Affected</span>
                      <span className="font-bold text-ink">{preview.removableDrivesAffectedCount}</span>
                    </div>
                    <div className="p-2 bg-card-muted/40 border border-line rounded">
                      <span className="text-ink-subtle text-[11px] block">Connected Displays</span>
                      <span className="font-bold text-ink">{preview.currentMonitorCount}</span>
                    </div>
                    <div className="p-2 bg-card-muted/40 border border-line rounded">
                      <span className="text-ink-subtle text-[11px] block">Remote Tools</span>
                      <span className="font-bold text-danger">{preview.detectedRemoteToolsCount}</span>
                    </div>
                  </div>

                  {preview.conflicts.length > 0 && (
                    <div className="p-3 rounded bg-danger/10 border border-danger/30 text-xs text-danger">
                      <strong className="block mb-1">Detected Policy Conflicts:</strong>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {preview.conflicts.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-semibold text-ink uppercase">
                    Peripheral &amp; Remote Violations Scan
                  </h5>
                  <Button
                    size="sm"
                    onClick={() => void handleScanViolations()}
                  >
                    Run Violation Scan
                  </Button>
                </div>

                {scanSummary && (
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
                            <td className="py-2.5 px-3 font-mono">{v.targetDevice}</td>
                            <td className="py-2.5 px-3 text-ink">{v.description}</td>
                            <td className="py-2.5 px-3 text-ink-subtle font-mono text-[11px]">{v.timestamp}</td>
                          </tr>
                        ))}
                        {scanSummary.violations.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-ok">
                              No active peripheral, display, or remote violations detected.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

