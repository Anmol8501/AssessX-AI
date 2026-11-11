import { useEffect, useState } from 'react'
import { RefreshIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, StatusBadge } from '@/components/ui'
import {
  applyCmdPolicy,
  applyPowerShellPolicy,
  applySystemUtilityPolicy,
  applyTaskManagerPolicy,
  getSystemUtilityInventory,
  getSystemUtilityPolicy,
  inspectCmdStatus,
  inspectPowerShellStatus,
  inspectTaskManagerStatus,
  previewSystemUtilityPolicy,
  revertSystemUtilityPolicy,
  scanSystemUtilityViolations,
} from './systemUtility'
import type {
  CmdRestrictionMode,
  CmdStatusReport,
  PowerShellRestrictionMode,
  PowerShellStatusReport,
  SystemUtilityItem,
  SystemUtilityPolicyConfig,
  SystemUtilityScanSummary,
  TaskManagerRestrictionMode,
  TaskManagerStatusReport,
  UtilityPolicyPreview,
} from './types'

export function SystemUtilityCard() {
  const [inventory, setInventory] = useState<SystemUtilityItem[]>([])
  const [powershell, setPowershell] = useState<PowerShellStatusReport | null>(null)
  const [cmd, setCmd] = useState<CmdStatusReport | null>(null)
  const [taskManager, setTaskManager] = useState<TaskManagerStatusReport | null>(null)
  const [policy, setPolicy] = useState<SystemUtilityPolicyConfig | null>(null)
  const [preview, setPreview] = useState<UtilityPolicyPreview | null>(null)
  const [scanSummary, setScanSummary] = useState<SystemUtilityScanSummary | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'shells' | 'inventory' | 'policy' | 'violations'>('shells')
  const [searchQuery, setSearchQuery] = useState('')

  // Policy form edits
  const [psMode, setPsMode] = useState<PowerShellRestrictionMode>('DetectionOnly')
  const [cmdMode, setCmdMode] = useState<CmdRestrictionMode>('DetectionOnly')
  const [tmMode, setTmMode] = useState<TaskManagerRestrictionMode>('DetectionOnly')
  const [regToolsBlocked, setRegToolsBlocked] = useState<boolean>(false)
  const [confirmApply, setConfirmApply] = useState<boolean>(false)

  const refreshAll = async () => {
    setLoading(true)
    try {
      const [inv, ps, c, tm, pol] = await Promise.all([
        getSystemUtilityInventory(),
        inspectPowerShellStatus(),
        inspectCmdStatus(),
        inspectTaskManagerStatus(),
        getSystemUtilityPolicy(),
      ])
      setInventory(inv)
      setPowershell(ps)
      setCmd(c)
      setTaskManager(tm)
      setPolicy(pol)

      setPsMode(pol.powershellMode)
      setCmdMode(pol.cmdMode)
      setTmMode(pol.taskManagerMode)
      setRegToolsBlocked(pol.registryToolsBlocked)

      const prev = await previewSystemUtilityPolicy(pol)
      setPreview(prev)
    } catch (e) {
      setActionMessage(`Refresh failed: ${e}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  const handleUpdateShellsDirect = async () => {
    setLoading(true)
    setActionMessage(null)
    try {
      await Promise.all([
        applyPowerShellPolicy(psMode),
        applyCmdPolicy(cmdMode),
        applyTaskManagerPolicy(tmMode),
      ])
      setActionMessage('Shell and task restrictions applied directly.')
      await refreshAll()
    } catch (e) {
      setActionMessage(`Failed to apply restrictions: ${e}`)
      setLoading(false)
    }
  }

  const handlePreviewPolicy = async () => {
    if (!policy) return
    const candidatePolicy: SystemUtilityPolicyConfig = {
      ...policy,
      powershellMode: psMode,
      cmdMode: cmdMode,
      taskManagerMode: tmMode,
      registryToolsBlocked: regToolsBlocked,
    }
    const prev = await previewSystemUtilityPolicy(candidatePolicy)
    setPreview(prev)
    setActionMessage('Policy preview regenerated.')
  }

  const handleApplyFullPolicy = async () => {
    if (!policy) return
    setLoading(true)
    setActionMessage(null)
    try {
      const candidatePolicy: SystemUtilityPolicyConfig = {
        ...policy,
        version: policy.version + 1,
        powershellMode: psMode,
        cmdMode: cmdMode,
        taskManagerMode: tmMode,
        registryToolsBlocked: regToolsBlocked,
      }
      const updated = await applySystemUtilityPolicy(candidatePolicy, confirmApply)
      setPolicy(updated)
      setConfirmApply(false)
      setActionMessage('System utility policy verified and applied.')
      await refreshAll()
    } catch (e) {
      setActionMessage(`Policy application error: ${e}`)
      setLoading(false)
    }
  }

  const handleRevertBaseline = async () => {
    setLoading(true)
    setActionMessage(null)
    try {
      const reverted = await revertSystemUtilityPolicy()
      setPolicy(reverted)
      setConfirmApply(false)
      setActionMessage('All system utility policies reverted to detection-only baseline.')
      await refreshAll()
    } catch (e) {
      setActionMessage(`Revert failed: ${e}`)
      setLoading(false)
    }
  }

  const handleRunSecurityScan = async () => {
    setLoading(true)
    try {
      const summary = await scanSystemUtilityViolations()
      setScanSummary(summary)
      setActionMessage(`Security scan completed. Found ${summary.violationsCount} violation(s).`)
    } catch (e) {
      setActionMessage(`Scan failed: ${e}`)
    } finally {
      setLoading(false)
    }
  }

  const filteredInventory = inventory.filter(
    (item) =>
      item.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.executableName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.category.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <Card className="col-span-full">
      <CardHeader
        title="System Utility & Shell Restrictions"
        description="Phase 2B: Account-scoped native restrictions for PowerShell, Command Prompt, Task Manager, and administrative utilities."
        actions={
          <Button variant="ghost" size="sm" onClick={() => void refreshAll()} disabled={loading}>
            <RefreshIcon className="h-4 w-4 mr-1.5" />
            Refresh
          </Button>
        }
      />
      <CardBody>
        {actionMessage && (
          <div className="mb-4 rounded-md border border-accent/30 bg-accent-soft p-3 text-xs text-ink">
            {actionMessage}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-line mb-6 gap-2">
          <button
            type="button"
            className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'shells'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
            onClick={() => setActiveTab('shells')}
          >
            Core Shells &amp; Task Manager
          </button>
          <button
            type="button"
            className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'inventory'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
            onClick={() => setActiveTab('inventory')}
          >
            Utility Inventory ({inventory.length})
          </button>
          <button
            type="button"
            className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'policy'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
            onClick={() => setActiveTab('policy')}
          >
            Policy Engine &amp; Approval
          </button>
          <button
            type="button"
            className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'violations'
                ? 'border-accent text-accent font-semibold'
                : 'border-transparent text-ink-subtle hover:text-ink'
            }`}
            onClick={() => setActiveTab('violations')}
          >
            Violations &amp; Security Scan {scanSummary?.hasViolations && '(!)'}
          </button>
        </div>

        {/* TAB 1: Core Shells & Task Manager */}
        {activeTab === 'shells' && (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              {/* PowerShell Card */}
              <div className="rounded-lg border border-line bg-card-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-ink">Windows PowerShell</h4>
                  <StatusBadge
                    tone={
                      powershell?.currentState === 'BlockedByPolicy'
                        ? 'danger'
                        : powershell?.currentState === 'Restricted'
                        ? 'warn'
                        : 'ok'
                    }
                  >
                    {powershell?.currentState ?? 'Unknown'}
                  </StatusBadge>
                </div>
                <div className="text-xs text-ink-muted space-y-1">
                  <div>Version: {powershell?.winPowershellVersion ?? 'Detected'}</div>
                  <div>Running Instances: {powershell?.runningInstancesCount ?? 0}</div>
                  <div>PowerShell 7 Core: {powershell?.pwsh7Installed ? 'Installed' : 'None'}</div>
                </div>
                <div className="pt-2 border-t border-line">
                  <label className="block text-[11px] font-medium text-ink-subtle mb-1">
                    Enforcement Mode
                  </label>
                  <select
                    className="w-full bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink"
                    value={psMode}
                    onChange={(e) => setPsMode(e.target.value as PowerShellRestrictionMode)}
                  >
                    <option value="DetectionOnly">Detection Only (Audit)</option>
                    <option value="Restrict">Restrict (Constrained Language)</option>
                    <option value="Block">Block Execution</option>
                    <option value="Allow">Allow (No Restrictions)</option>
                  </select>
                </div>
              </div>

              {/* Command Prompt Card */}
              <div className="rounded-lg border border-line bg-card-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-ink">Command Prompt (cmd.exe)</h4>
                  <StatusBadge
                    tone={
                      cmd?.currentState === 'BlockedByPolicy'
                        ? 'danger'
                        : cmd?.currentState === 'Restricted'
                        ? 'warn'
                        : 'ok'
                    }
                  >
                    {cmd?.currentState ?? 'Unknown'}
                  </StatusBadge>
                </div>
                <div className="text-xs text-ink-muted space-y-1">
                  <div>DisableCMD Value: {cmd?.disableCmdRegistryValue ?? 'None (0)'}</div>
                  <div>Running Instances: {cmd?.runningInstancesCount ?? 0}</div>
                  <div>Executable Path: System32\cmd.exe</div>
                </div>
                <div className="pt-2 border-t border-line">
                  <label className="block text-[11px] font-medium text-ink-subtle mb-1">
                    Enforcement Mode
                  </label>
                  <select
                    className="w-full bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink"
                    value={cmdMode}
                    onChange={(e) => setCmdMode(e.target.value as CmdRestrictionMode)}
                  >
                    <option value="DetectionOnly">Detection Only (Audit)</option>
                    <option value="Restrict">Restrict (Interactive Prompt Off)</option>
                    <option value="Block">Block (Prompt &amp; Scripts Off)</option>
                    <option value="Allow">Allow (No Restrictions)</option>
                  </select>
                </div>
              </div>

              {/* Task Manager Card */}
              <div className="rounded-lg border border-line bg-card-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-ink">Windows Task Manager</h4>
                  <StatusBadge tone={taskManager?.currentState === 'BlockedByPolicy' ? 'danger' : 'ok'}>
                    {taskManager?.currentState ?? 'Unknown'}
                  </StatusBadge>
                </div>
                <div className="text-xs text-ink-muted space-y-1">
                  <div>DisableTaskMgr: {taskManager?.disableTaskmgrRegistryValue ? 'Enabled (1)' : 'None (0)'}</div>
                  <div>Running Instances: {taskManager?.runningInstancesCount ?? 0}</div>
                  <div>Admin Recovery: Preserved</div>
                </div>
                <div className="pt-2 border-t border-line">
                  <label className="block text-[11px] font-medium text-ink-subtle mb-1">
                    Enforcement Mode
                  </label>
                  <select
                    className="w-full bg-surface border border-line rounded px-2 py-1.5 text-xs text-ink"
                    value={tmMode}
                    onChange={(e) => setTmMode(e.target.value as TaskManagerRestrictionMode)}
                  >
                    <option value="DetectionOnly">Detection Only (Audit)</option>
                    <option value="Block">Block Task Manager Access</option>
                    <option value="Allow">Allow (No Restrictions)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-line">
              <span className="text-xs text-ink-muted">
                Restrictions target the <strong className="text-ink">AssessXCandidate</strong> local profile or active session.
              </span>
              <Button size="sm" onClick={() => void handleUpdateShellsDirect()} disabled={loading}>
                Apply Shell Restrictions
              </Button>
            </div>
          </div>
        )}

        {/* TAB 2: System Utility Inventory */}
        {activeTab === 'inventory' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <input
                type="text"
                placeholder="Search utilities by name or category..."
                className="bg-surface border border-line rounded px-3 py-1.5 text-xs text-ink w-72 focus:outline-none focus:border-accent"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <span className="text-xs text-ink-subtle">
                Displaying {filteredInventory.length} of {inventory.length} utilities
              </span>
            </div>

            <div className="overflow-x-auto border border-line rounded-lg">
              <table className="w-full text-left text-xs text-ink-muted">
                <thead className="bg-card-muted/60 text-ink-subtle border-b border-line">
                  <tr>
                    <th className="py-2.5 px-3">Utility Name</th>
                    <th className="py-2.5 px-3">Executable</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Criticality</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">SHA-256 Digest</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-surface">
                  {filteredInventory.map((item) => (
                    <tr key={item.utilityId} className="hover:bg-card-muted/40">
                      <td className="py-2.5 px-3 font-medium text-ink">
                        {item.displayName}
                        {item.isCriticalProtected && (
                          <span className="ml-2 text-[10px] bg-ok/10 text-ok border border-ok/30 px-1.5 py-0.5 rounded">
                            Protected OS
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-ink-subtle">{item.executableName}</td>
                      <td className="py-2.5 px-3 text-ink-subtle">{item.category}</td>
                      <td className="py-2.5 px-3">
                        <StatusBadge
                          tone={
                            item.criticality === 'CriticalProtected'
                              ? 'ok'
                              : item.criticality === 'HighRisk'
                              ? 'danger'
                              : 'warn'
                          }
                        >
                          {item.criticality}
                        </StatusBadge>
                      </td>
                      <td className="py-2.5 px-3">
                        {item.isInstalled ? (
                          <span className="text-ok text-[11px] font-medium">Installed</span>
                        ) : (
                          <span className="text-ink-subtle text-[11px]">Not Found</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-ink-subtle truncate max-w-[140px]">
                        {item.fileHash ? item.fileHash.slice(0, 16) + '...' : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: Policy Engine & Approval */}
        {activeTab === 'policy' && (
          <div className="space-y-6">
            <div className="rounded-lg border border-line bg-card-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-ink">System Utility Policy Lifecycle</h4>
                  <p className="text-xs text-ink-subtle">
                    Version: {policy?.version} &middot; Target Account: {policy?.candidateAccount ?? 'Current User'}
                  </p>
                </div>
                <StatusBadge tone={policy?.state === 'Active' ? 'ok' : 'warn'}>
                  {policy?.state ?? 'Draft'}
                </StatusBadge>
              </div>

              {preview && (
                <div className="rounded border border-line bg-surface p-3 text-xs space-y-2">
                  <div className="font-semibold text-ink">Safety &amp; Conflict Preview:</div>
                  <div className="text-ink-muted">{preview.safetySummary}</div>
                  {preview.affectedRegistryKeys.length > 0 && (
                    <div>
                      <span className="text-ink-subtle">Registry Keys Targeted:</span>
                      <ul className="list-disc list-inside text-ink-muted font-mono text-[11px] mt-1">
                        {preview.affectedRegistryKeys.map((k) => (
                          <li key={k}>{k}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {preview.conflicts.length > 0 && (
                    <div className="text-danger space-y-1">
                      {preview.conflicts.map((c, idx) => (
                        <div key={idx}>
                          [{c.severity}] {c.executableName}: {c.description}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="regTools"
                  checked={regToolsBlocked}
                  onChange={(e) => setRegToolsBlocked(e.target.checked)}
                  className="rounded border-line text-accent"
                />
                <label htmlFor="regTools" className="text-xs text-ink font-medium">
                  Block Registry Tools (regedit.exe) &amp; MMC Consoles
                </label>
              </div>

              <div className="pt-4 border-t border-line space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="confirmApply"
                    checked={confirmApply}
                    onChange={(e) => setConfirmApply(e.target.checked)}
                    className="rounded border-line text-accent"
                  />
                  <label htmlFor="confirmApply" className="text-xs text-ink-muted">
                    I confirm administrator authorization to apply these system utility restrictions.
                  </label>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void handlePreviewPolicy()} disabled={loading}>
                    Preview Changes
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void handleApplyFullPolicy()}
                    disabled={loading || !confirmApply}
                  >
                    Apply &amp; Verify Policy
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void handleRevertBaseline()}
                    disabled={loading}
                  >
                    Revert to Safe Baseline
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Violations & Security Scan */}
        {activeTab === 'violations' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-ink">Active Process Scan &amp; Tamper Verification</h4>
                <p className="text-xs text-ink-subtle">
                  Inspects running processes against active PowerShell, CMD, and Utility policies.
                </p>
              </div>
              <Button size="sm" onClick={() => void handleRunSecurityScan()} disabled={loading}>
                Run Security Scan Now
              </Button>
            </div>

            {scanSummary && (
              <div className="space-y-3">
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                  <div className="rounded border border-line bg-card-muted/30 p-3 text-center">
                    <div className="text-xs text-ink-subtle">Processes Checked</div>
                    <div className="text-xl font-bold text-ink">{scanSummary.totalProcessesChecked}</div>
                  </div>
                  <div className="rounded border border-line bg-card-muted/30 p-3 text-center">
                    <div className="text-xs text-ink-subtle">Violations Found</div>
                    <div
                      className={`text-xl font-bold ${
                        scanSummary.violationsCount > 0 ? 'text-danger' : 'text-ok'
                      }`}
                    >
                      {scanSummary.violationsCount}
                    </div>
                  </div>
                  <div className="rounded border border-line bg-card-muted/30 p-3 text-center">
                    <div className="text-xs text-ink-subtle">Environment State</div>
                    <div className="text-sm font-semibold text-ink">
                      {scanSummary.hasViolations ? 'Compromised' : 'Secured'}
                    </div>
                  </div>
                  <div className="rounded border border-line bg-card-muted/30 p-3 text-center">
                    <div className="text-xs text-ink-subtle">Security Agent</div>
                    <div className="text-sm font-semibold text-ok">Monitoring Active</div>
                  </div>
                </div>

                {scanSummary.violations.length > 0 ? (
                  <div className="overflow-x-auto border border-danger/30 rounded-lg">
                    <table className="w-full text-left text-xs text-ink-muted">
                      <thead className="bg-danger/10 text-danger border-b border-danger/20">
                        <tr>
                          <th className="py-2 px-3">Executable</th>
                          <th className="py-2 px-3">Process ID</th>
                          <th className="py-2 px-3">Violation Type</th>
                          <th className="py-2 px-3">Enforcement Action</th>
                          <th className="py-2 px-3">Rule Reference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line bg-surface">
                        {scanSummary.violations.map((v, i) => (
                          <tr key={i} className="hover:bg-card-muted/40">
                            <td className="py-2 px-3 font-semibold text-ink">{v.executableName}</td>
                            <td className="py-2 px-3 font-mono text-ink-subtle">{v.processId}</td>
                            <td className="py-2 px-3 text-danger">{v.classification}</td>
                            <td className="py-2 px-3 font-semibold">{v.actionTaken}</td>
                            <td className="py-2 px-3 text-ink-subtle">{v.policyRule}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded border border-ok/30 bg-ok/10 p-4 text-center text-xs text-ok">
                    No system utility violations detected. Examination workstation is compliant.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
