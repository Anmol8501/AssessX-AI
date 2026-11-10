import { useEffect, useState } from 'react'
import { RefreshIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, StatusBadge } from '@/components/ui'
import {
  addAllowlistRule,
  applyApplicationPolicy,
  getEnforcementCapabilities,
  getApplicationAllowlist,
  getApplicationInventory,
  getPolicyState,
  previewApplicationPolicy,
  removeAllowlistRule,
  restoreApplicationPolicyBaseline,
  scanApplicationViolations,
} from './applicationControl'
import type {
  AllowlistCategory,
  AllowlistEntry,
  ApplicationIdentity,
  ApplicationScanSummary,
  EnforcementCapabilityReport,
  PolicyEngineState,
  PolicyMode,
  PolicyPreview,
  RuleAction,
  RuleType,
} from './types'

export function ApplicationControlCard() {
  const [inventory, setInventory] = useState<ApplicationIdentity[]>([])
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([])
  const [capabilities, setCapabilities] = useState<EnforcementCapabilityReport | null>(null)
  const [policyState, setPolicyState] = useState<PolicyEngineState | null>(null)
  const [policyPreview, setPolicyPreview] = useState<PolicyPreview | null>(null)
  const [scanSummary, setScanSummary] = useState<ApplicationScanSummary | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'inventory' | 'allowlist' | 'capabilities' | 'policy'>('inventory')

  // Add rule form state
  const [newRuleName, setNewRuleName] = useState('')
  const [newRuleCategory, setNewRuleCategory] = useState<AllowlistCategory>('ApprovedSupport')
  const [newRuleType, setNewRuleType] = useState<RuleType>('ExecutableName')
  const [newRuleValue, setNewRuleValue] = useState('')
  const [newRuleAction, setNewRuleAction] = useState<RuleAction>('Allow')
  const [newRuleReason, setNewRuleReason] = useState('')

  // Policy mode selection
  const [selectedMode, setSelectedMode] = useState<PolicyMode>('AuditMode')
  const [confirmApply, setConfirmApply] = useState<boolean>(false)

  const refreshAll = async () => {
    setLoading(true)
    try {
      const [inv, rules, caps, state, scan] = await Promise.all([
        getApplicationInventory(),
        getApplicationAllowlist(),
        getEnforcementCapabilities(),
        getPolicyState(),
        scanApplicationViolations(),
      ])
      setInventory(inv)
      setAllowlist(rules)
      setCapabilities(caps)
      setPolicyState(state)
      setSelectedMode(state.mode)
      setScanSummary(scan)
    } catch (err) {
      setActionMessage(`Error refreshing application control state: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  const handleAddRule = async () => {
    if (!newRuleName.trim() || !newRuleValue.trim()) {
      setActionMessage('Please specify both a rule name and a rule value.')
      return
    }

    try {
      await addAllowlistRule(
        newRuleName.trim(),
        newRuleCategory,
        newRuleType,
        newRuleValue.trim(),
        newRuleAction,
        newRuleReason.trim() || 'Administrator approved'
      )
      setActionMessage(`Rule '${newRuleName}' added successfully.`)
      setNewRuleName('')
      setNewRuleValue('')
      setNewRuleReason('')
      const updated = await getApplicationAllowlist()
      setAllowlist(updated)
    } catch (err) {
      setActionMessage(`Failed to add rule: ${err}`)
    }
  }

  const handleRemoveRule = async (ruleId: string) => {
    try {
      await removeAllowlistRule(ruleId)
      setActionMessage('Custom rule removed successfully.')
      const updated = await getApplicationAllowlist()
      setAllowlist(updated)
    } catch (err) {
      setActionMessage(`Failed to remove rule: ${err}`)
    }
  }

  const handlePreviewPolicy = async () => {
    try {
      const prev = await previewApplicationPolicy(selectedMode)
      setPolicyPreview(prev)
      setActionMessage(`Preview generated for policy in ${selectedMode}.`)
    } catch (err) {
      setActionMessage(`Failed to generate preview: ${err}`)
    }
  }

  const handleApplyPolicy = async () => {
    try {
      const res = await applyApplicationPolicy(selectedMode, confirmApply)
      setActionMessage(res.message)
      setConfirmApply(false)
      await refreshAll()
    } catch (err) {
      setActionMessage(`Failed to apply policy: ${err}`)
    }
  }

  const handleRestoreBaseline = async () => {
    try {
      const res = await restoreApplicationPolicyBaseline()
      setActionMessage(res.message)
      await refreshAll()
    } catch (err) {
      setActionMessage(`Failed to restore baseline: ${err}`)
    }
  }

  const handleScanViolations = async () => {
    try {
      const scan = await scanApplicationViolations()
      setScanSummary(scan)
      setActionMessage(
        scan.hasViolations
          ? `Scan complete: ${scan.violations.length} violation(s) detected.`
          : 'Scan complete: No application violations detected.'
      )
    } catch (err) {
      setActionMessage(`Scan failed: ${err}`)
    }
  }

  const headerActions = (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => void refreshAll()}
      disabled={loading}
      className="flex items-center gap-2"
    >
      <RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
      Refresh
    </Button>
  )

  return (
    <Card className="border border-border/80 shadow-sm">
      <CardHeader
        title="Application Allowlisting & Execution Control"
        description="Phase 2A — Windows Process Inventory, Categorized Allowlist & Enforcement Capability"
        actions={headerActions}
      />

      <CardBody className="space-y-4 pt-0">
        {actionMessage && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-foreground flex items-center justify-between">
            <span>{actionMessage}</span>
            <button
              onClick={() => setActionMessage(null)}
              className="text-muted-foreground hover:text-foreground ml-2"
            >
              ✕
            </button>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex border-b border-border text-sm">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`border-b-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'inventory'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Running Inventory ({inventory.length})
          </button>
          <button
            onClick={() => setActiveTab('allowlist')}
            className={`border-b-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'allowlist'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Allowlist Rules ({allowlist.length})
          </button>
          <button
            onClick={() => setActiveTab('capabilities')}
            className={`border-b-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'capabilities'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Enforcement Capabilities
          </button>
          <button
            onClick={() => setActiveTab('policy')}
            className={`border-b-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'policy'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Policy Engine &amp; Lifecycle
          </button>
        </div>

        {/* Tab 1: Running Inventory */}
        {activeTab === 'inventory' && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Active process binaries discovered with normalized identity, digital signature, and SHA-256 hashes.
              </span>
              <Button variant="secondary" size="sm" onClick={() => void handleScanViolations()}>
                Scan for Violations
              </Button>
            </div>

            {scanSummary?.hasViolations && (
              <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400">
                <span className="font-semibold">Policy Violations Active: </span>
                {scanSummary.violations.map((v) => `${v.application.executableName} (${v.classification})`).join(', ')}
              </div>
            )}

            <div className="divide-y divide-border rounded-lg border border-border max-h-96 overflow-y-auto">
              {inventory.map((app) => (
                <div key={app.executablePath} className="p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{app.displayName}</span>
                    <div className="flex items-center gap-2">
                      <StatusBadge tone={app.signatureStatus === 'SignedTrusted' ? 'ok' : 'neutral'}>
                        {app.signatureStatus}
                      </StatusBadge>
                      <span className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">
                        PIDs: {app.processIds.join(', ')}
                      </span>
                    </div>
                  </div>
                  <div className="text-muted-foreground font-mono text-[11px] truncate">
                    Path: {app.executablePath}
                  </div>
                  <div className="text-muted-foreground font-mono text-[11px] truncate">
                    SHA-256: {app.fileHash}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 2: Allowlist Rules */}
        {activeTab === 'allowlist' && (
          <div className="space-y-4 pt-2">
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <span className="text-xs font-semibold uppercase text-foreground">Add Custom Allowlist Rule</span>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Application Name"
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  className="rounded border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <input
                  type="text"
                  placeholder="Rule Value (e.g. calc.exe or SHA-256)"
                  value={newRuleValue}
                  onChange={(e) => setNewRuleValue(e.target.value)}
                  className="rounded border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <input
                  type="text"
                  placeholder="Justification / Reason"
                  value={newRuleReason}
                  onChange={(e) => setNewRuleReason(e.target.value)}
                  className="rounded border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Category:</span>
                  <select
                    value={newRuleCategory}
                    onChange={(e) => setNewRuleCategory(e.target.value as AllowlistCategory)}
                    className="rounded border border-border bg-card px-2 py-1 text-foreground text-xs"
                  >
                    <option value="ApprovedSupport">Approved Support</option>
                    <option value="ApprovedAccessibility">Approved Accessibility</option>
                    <option value="ApprovedInput">Approved Input</option>
                    <option value="BlockedApplication">Blocked Application</option>
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Type:</span>
                  <select
                    value={newRuleType}
                    onChange={(e) => setNewRuleType(e.target.value as RuleType)}
                    className="rounded border border-border bg-card px-2 py-1 text-foreground text-xs"
                  >
                    <option value="ExecutableName">Executable Name</option>
                    <option value="Hash">SHA-256 Hash</option>
                    <option value="Publisher">Publisher</option>
                    <option value="Path">Directory Path</option>
                  </select>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Action:</span>
                  <select
                    value={newRuleAction}
                    onChange={(e) => setNewRuleAction(e.target.value as RuleAction)}
                    className="rounded border border-border bg-card px-2 py-1 text-foreground text-xs"
                  >
                    <option value="Allow">Allow</option>
                    <option value="Deny">Deny</option>
                    <option value="Audit">Audit</option>
                  </select>
                </div>

                <Button variant="primary" size="sm" onClick={() => void handleAddRule()}>
                  Add Rule
                </Button>
              </div>
            </div>

            <div className="divide-y divide-border rounded-lg border border-border max-h-96 overflow-y-auto">
              {allowlist.map((rule) => (
                <div key={rule.id} className="p-3 text-xs flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{rule.name}</span>
                      <StatusBadge tone={rule.action === 'Allow' ? 'ok' : rule.action === 'Deny' ? 'danger' : 'warn'}>
                        {rule.action}
                      </StatusBadge>
                      <span className="text-[11px] text-muted-foreground">({rule.category})</span>
                    </div>
                    <div className="text-muted-foreground font-mono text-[11px]">
                      Match: [{rule.ruleType}] {rule.ruleValue}
                    </div>
                    <div className="text-[11px] text-muted-foreground">Reason: {rule.reason}</div>
                  </div>

                  <div>
                    {rule.isSystemRule ? (
                      <span className="text-[11px] font-mono text-muted-foreground">System Protected</span>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => void handleRemoveRule(rule.id)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Enforcement Capabilities */}
        {activeTab === 'capabilities' && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">Windows Edition</span>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {capabilities?.windowsEdition ?? 'Unknown'}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">Primary Mechanism</span>
                <div className="mt-1 flex items-center gap-2">
                  <StatusBadge tone={capabilities?.isEnforcementCapable ? 'ok' : 'warn'}>
                    {capabilities?.primaryMechanism ?? 'None'}
                  </StatusBadge>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">Enforcement Capability</span>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {capabilities?.isEnforcementCapable ? 'Capable' : 'Supervision Only'}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 space-y-2 text-xs">
              <span className="font-semibold text-foreground">Mechanism Readiness:</span>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div>
                  <span className="text-muted-foreground">WDAC Support: </span>
                  <span className="font-semibold text-foreground">{capabilities?.wdacSupported ? 'Yes' : 'No'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">AppLocker Support: </span>
                  <span className="font-semibold text-foreground">{capabilities?.applockerSupported ? 'Yes' : 'No'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">AppIDSvc Running: </span>
                  <span className="font-semibold text-foreground">{capabilities?.appidsvcRunning ? 'Yes' : 'No'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Process Supervision: </span>
                  <span className="font-semibold text-foreground">{capabilities?.processSupervisionActive ? 'Active' : 'Offline'}</span>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{capabilities?.summary}</p>

            {capabilities?.recommendations && capabilities.recommendations.length > 0 && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1 text-xs">
                <span className="font-semibold text-foreground">Recommendations:</span>
                <ul className="list-disc pl-4 text-muted-foreground space-y-0.5">
                  {capabilities.recommendations.map((rec, idx) => (
                    <li key={idx}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Policy Lifecycle & Preview */}
        {activeTab === 'policy' && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">Policy State</span>
                <div className="mt-1">
                  <StatusBadge tone={policyState?.state === 'Active' ? 'ok' : 'neutral'}>
                    {policyState?.state ?? 'Draft'}
                  </StatusBadge>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">Active Policy Mode</span>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {policyState?.mode ?? 'AuditMode'}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">Policy Version</span>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  v{policyState?.version ?? 1}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <span className="text-xs font-semibold uppercase text-foreground">Configure &amp; Apply Policy</span>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Target Mode:</span>
                  <select
                    value={selectedMode}
                    onChange={(e) => setSelectedMode(e.target.value as PolicyMode)}
                    className="rounded border border-border bg-card px-2 py-1 text-foreground text-xs"
                  >
                    <option value="AuditMode">Audit Mode (Safe, Log-Only)</option>
                    <option value="EnforcementMode">Enforcement Mode (Active Supervision)</option>
                  </select>
                </div>

                <Button variant="secondary" size="sm" onClick={() => void handlePreviewPolicy()}>
                  Preview Policy Changes
                </Button>

                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={confirmApply}
                    onChange={(e) => setConfirmApply(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span>Authorize Administrator Application</span>
                </label>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleApplyPolicy()}
                  disabled={!confirmApply}
                >
                  Apply Policy
                </Button>

                <Button variant="secondary" size="sm" onClick={() => void handleRestoreBaseline()}>
                  Restore Baseline
                </Button>
              </div>
            </div>

            {policyPreview && (
              <div className="rounded-lg border border-border p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Planned Policy Preview ({policyPreview.mode})</span>
                  <StatusBadge tone={policyPreview.isSafeToApply ? 'ok' : 'danger'}>
                    {policyPreview.isSafeToApply ? 'SAFE TO APPLY' : 'VALIDATION FAILED'}
                  </StatusBadge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-muted-foreground">
                  <div>Allowed: {policyPreview.allowedCount}</div>
                  <div>Denied: {policyPreview.deniedCount}</div>
                  <div>Total Rules: {policyPreview.totalRules}</div>
                </div>
                <div className="space-y-1">
                  <span className="text-foreground font-semibold">Planned Steps:</span>
                  <ul className="list-disc pl-4 text-muted-foreground">
                    {policyPreview.plannedActions.map((act, i) => (
                      <li key={i}>{act}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

