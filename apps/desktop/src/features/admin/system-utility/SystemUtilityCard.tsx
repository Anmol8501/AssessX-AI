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
          <div className="mb-4 rounded-md bg-slate-900/40 border border-slate-800 p-3 text-xs text-sky-300">
            {actionMessage}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 mb-6 gap-2">
          <button
            type="button"
            className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'shells'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setActiveTab('shells')}
          >
            Core Shells &amp; Task Manager
          </button>
          <button
            type="button"
            className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'inventory'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setActiveTab('inventory')}
          >
            Utility Inventory ({inventory.length})
          </button>
          <button
            type="button"
            className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'policy'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
            onClick={() => setActiveTab('policy')}
          >
            Policy Engine &amp; Approval
          </button>
          <button
            type="button"
            className={`pb-2 px-3 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'violations'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
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
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-200">Windows PowerShell</h4>
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
                <div className="text-xs text-slate-400 space-y-1">
                  <div>Version: {powershell?.winPowershellVersion ?? 'Not Detected'}</div>
                  <div>Running Instances: {powershell?.runningInstancesCount ?? 0}</div>
                  <div>PowerShell 7 Core: {powershell?.pwsh7Installed ? 'Installed' : 'None'}</div>
                </div>
                <div className="pt-2 border-t border-slate-800/80">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Enforcement Mode
                  </label>
                  <select
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
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
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-200">Command Prompt (cmd.exe)</h4>
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
                <div className="text-xs text-slate-400 space-y-1">
                  <div>DisableCMD Value: {cmd?.disableCmdRegistryValue ?? 'None (0)'}</div>
                  <div>Running Instances: {cmd?.runningInstancesCount ?? 0}</div>
                  <div>Executable Path: System32\cmd.exe</div>
                </div>
                <div className="pt-2 border-t border-slate-800/80">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Enforcement Mode
                  </label>
                  <select
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
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
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-200">Windows Task Manager</h4>
                  <StatusBadge tone={taskManager?.currentState === 'BlockedByPolicy' ? 'danger' : 'ok'}>
                    {taskManager?.currentState ?? 'Unknown'}
                  </StatusBadge>
                </div>
                <div className="text-xs text-slate-400 space-y-1">
                  <div>DisableTaskMgr: {taskManager?.disableTaskmgrRegistryValue ? 'Enabled (1)' : 'None (0)'}</div>
                  <div>Running Instances: {taskManager?.runningInstancesCount ?? 0}</div>
                  <div>Admin Recovery: Preserved</div>
                </div>
                <div className="pt-2 border-t border-slate-800/80">
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Enforcement Mode
                  </label>
                  <select
                    className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200"
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

            <div className="flex justify-between items-center pt-3 border-t border-slate-800">
              <span className="text-xs text-slate-400">
                Restrictions will target the <strong>AssessXCandidate</strong> local profile.
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
                className="bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs text-slate-200 w-72"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <span className="text-xs text-slate-400">
                Displaying {filteredInventory.length} of {inventory.length} utilities
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-lg">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3">Utility Name</th>
                    <th className="py-2.5 px-3">Executable</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Criticality</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">SHA-256 Digest</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredInventory.map((item) => (
                    <tr key={item.utilityId} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-3 font-medium text-slate-200">
                        {item.displayName}
                        {item.isCriticalProtected && (
                          <span className="ml-2 text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded">
                            Protected OS
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-400">{item.executableName}</td>
                      <td className="py-2.5 px-3 text-slate-400">{item.category}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                            item.criticality === 'CriticalProtected'
                              ? 'bg-emerald-900/60 text-emerald-300'
                              : item.criticality === 'HighRisk'
                              ? 'bg-rose-900/60 text-rose-300'
                              : 'bg-amber-900/60 text-amber-300'
                          }`}
                        >
                          {item.criticality}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        {item.isInstalled ? (
                          <span className="text-emerald-400 text-[11px]">Installed</span>
                        ) : (
                          <span className="text-slate-500 text-[11px]">Not Found</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-400 truncate max-w-[140px]">
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
            <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">System Utility Policy Lifecycle</h4>
                  <p className="text-xs text-slate-400">
                    Version: {policy?.version} &middot; Target Account: {policy?.candidateAccount ?? 'Current User'}
                  </p>
                </div>
                <StatusBadge tone={policy?.state === 'Active' ? 'ok' : 'warn'}>
                  {policy?.state ?? 'Draft'}
                </StatusBadge>
              </div>

              {preview && (
                <div className="rounded border border-slate-800 bg-slate-950 p-3 text-xs space-y-2">
                  <div className="font-semibold text-slate-300">Safety &amp; Conflict Preview:</div>
                  <div className="text-slate-400">{preview.safetySummary}</div>
                  {preview.affectedRegistryKeys.length > 0 && (
                    <div>
                      <span className="text-slate-500">Registry Keys Targeted:</span>
                      <ul className="list-disc list-inside text-slate-400 font-mono text-[11px] mt-1">
                        {preview.affectedRegistryKeys.map((k) => (
                          <li key={k}>{k}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {preview.conflicts.length > 0 && (
                    <div className="text-rose-400 space-y-1">
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
                  className="rounded border-slate-700 bg-slate-950 text-sky-500"
                />
                <label htmlFor="regTools" className="text-xs text-slate-300 font-medium">
                  Block Registry Tools (regedit.exe) &amp; MMC Consoles
                </label>
              </div>

              <div className="pt-4 border-t border-slate-800 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="confirmApply"
                    checked={confirmApply}
                    onChange={(e) => setConfirmApply(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-950 text-sky-500"
                  />
                  <label htmlFor="confirmApply" className="text-xs text-slate-300">
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
                <h4 className="text-sm font-semibold text-slate-200">Active Process Scan &amp; Tamper Verification</h4>
                <p className="text-xs text-slate-400">
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
                  <div className="rounded border border-slate-800 bg-slate-900/60 p-3 text-center">
                    <div className="text-xs text-slate-400">Processes Checked</div>
                    <div className="text-xl font-bold text-slate-200">{scanSummary.totalProcessesChecked}</div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/60 p-3 text-center">
                    <div className="text-xs text-slate-400">Violations Found</div>
                    <div
                      className={`text-xl font-bold ${
                        scanSummary.violationsCount > 0 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {scanSummary.violationsCount}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/60 p-3 text-center">
                    <div className="text-xs text-slate-400">Environment State</div>
                    <div className="text-sm font-semibold text-slate-200">
                      {scanSummary.hasViolations ? 'Compromised' : 'Secured'}
                    </div>
                  </div>
                  <div className="rounded border border-slate-800 bg-slate-900/60 p-3 text-center">
                    <div className="text-xs text-slate-400">Security Agent</div>
                    <div className="text-sm font-semibold text-emerald-400">Monitoring Active</div>
                  </div>
                </div>

                {scanSummary.violations.length > 0 ? (
                  <div className="overflow-x-auto border border-rose-900/50 rounded-lg">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-rose-950/40 text-rose-300 border-b border-rose-900/50">
                        <tr>
                          <th className="py-2 px-3">Executable</th>
                          <th className="py-2 px-3">Process ID</th>
                          <th className="py-2 px-3">Violation Type</th>
                          <th className="py-2 px-3">Enforcement Action</th>
                          <th className="py-2 px-3">Rule Reference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {scanSummary.violations.map((v, i) => (
                          <tr key={i} className="hover:bg-slate-900/40">
                            <td className="py-2 px-3 font-semibold text-slate-200">{v.executableName}</td>
                            <td className="py-2 px-3 font-mono text-slate-400">{v.processId}</td>
                            <td className="py-2 px-3 text-rose-400">{v.classification}</td>
                            <td className="py-2 px-3 font-semibold">{v.actionTaken}</td>
                            <td className="py-2 px-3 text-slate-400">{v.policyRule}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded border border-emerald-900/40 bg-emerald-950/20 p-4 text-center text-xs text-emerald-300">
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
