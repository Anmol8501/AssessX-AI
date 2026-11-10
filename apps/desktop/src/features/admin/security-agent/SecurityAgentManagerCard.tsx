import { useEffect, useState } from 'react'
import { RefreshIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, StatusBadge } from '@/components/ui'
import {
  getAgentRecoveryStatus,
  getAgentTamperEvents,
  getDeviceComplianceReport,
  getSecurityAgentStatus,
  installSecurityAgentService,
  resetAgentRecovery,
  startSecurityAgentDaemon,
  stopSecurityAgentDaemon,
  uninstallSecurityAgentService,
  verifyComponentIntegrity,
} from './securityAgent'
import type {
  ComplianceReport,
  IntegrityReport,
  RecoveryStatus,
  SecurityAgentStatus,
  TamperEvent,
} from './types'

export function SecurityAgentManagerCard() {
  const [status, setStatus] = useState<SecurityAgentStatus | null>(null)
  const [compliance, setCompliance] = useState<ComplianceReport | null>(null)
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null)
  const [tamperEvents, setTamperEvents] = useState<TamperEvent[]>([])
  const [recovery, setRecovery] = useState<RecoveryStatus | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'status' | 'compliance' | 'integrity' | 'tamper'>(
    'status'
  )

  const refreshAll = async () => {
    setLoading(true)
    try {
      const [agentStatus, complianceReport, integrityReport, events, recoveryStatus] =
        await Promise.all([
          getSecurityAgentStatus(),
          getDeviceComplianceReport(),
          verifyComponentIntegrity(),
          getAgentTamperEvents(),
          getAgentRecoveryStatus(),
        ])
      setStatus(agentStatus)
      setCompliance(complianceReport)
      setIntegrity(integrityReport)
      setTamperEvents(events)
      setRecovery(recoveryStatus)
    } catch (err) {
      setActionMessage(`Error refreshing agent state: ${err}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  const handleStartDaemon = async () => {
    try {
      const updated = await startSecurityAgentDaemon()
      setStatus(updated)
      setActionMessage('In-process Security Agent daemon started successfully.')
    } catch (err) {
      setActionMessage(`Failed to start daemon: ${err}`)
    }
  }

  const handleStopDaemon = async () => {
    try {
      const updated = await stopSecurityAgentDaemon()
      setStatus(updated)
      setActionMessage('Security Agent daemon stopped.')
    } catch (err) {
      setActionMessage(`Failed to stop daemon: ${err}`)
    }
  }

  const handleInstallService = async () => {
    try {
      const res = await installSecurityAgentService()
      setActionMessage(res)
      await refreshAll()
    } catch (err) {
      setActionMessage(`Failed to register Windows Service: ${err}`)
    }
  }

  const handleUninstallService = async () => {
    try {
      const res = await uninstallSecurityAgentService()
      setActionMessage(res)
      await refreshAll()
    } catch (err) {
      setActionMessage(`Failed to remove Windows Service: ${err}`)
    }
  }

  const handleResetRecovery = async () => {
    try {
      await resetAgentRecovery()
      const rec = await getAgentRecoveryStatus()
      setRecovery(rec)
      setActionMessage('Recovery lockout reset by administrator.')
    } catch (err) {
      setActionMessage(`Failed to reset recovery: ${err}`)
    }
  }

  const formatUptime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m ${secs}s`
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
        title="Native Security Agent & System Integration"
        description="Phase 1C — Continuous Service Monitoring, Named Pipe IPC, Compliance & Integrity"
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
            onClick={() => setActiveTab('status')}
            className={`border-b-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'status'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Service Lifecycle
          </button>
          <button
            onClick={() => setActiveTab('compliance')}
            className={`border-b-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'compliance'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Device Compliance
          </button>
          <button
            onClick={() => setActiveTab('integrity')}
            className={`border-b-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'integrity'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Component Integrity
          </button>
          <button
            onClick={() => setActiveTab('tamper')}
            className={`border-b-2 px-4 py-2 font-medium transition-colors ${
              activeTab === 'tamper'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Tamper &amp; Recovery
          </button>
        </div>

        {/* Tab 1: Service Lifecycle */}
        {activeTab === 'status' && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">Service State</span>
                <div className="mt-1 flex items-center gap-2">
                  <StatusBadge
                    tone={
                      status?.state === 'Running'
                        ? 'ok'
                        : status?.state === 'Stopped'
                          ? 'neutral'
                          : 'warn'
                    }
                  >
                    {status?.state ?? 'UNKNOWN'}
                  </StatusBadge>
                  {status?.isDaemonMode && (
                    <span className="text-xs font-mono bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                      Daemon
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">Process PID</span>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {status?.pid ? `#${status.pid}` : 'None (Offline)'}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs text-muted-foreground">Uptime</span>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  {status?.uptimeSeconds ? formatUptime(status.uptimeSeconds) : '0s'}
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">{status?.message}</p>

            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <h4 className="text-xs font-semibold uppercase text-foreground">Lifecycle Operations</h4>
              <div className="flex flex-wrap gap-2">
                {status?.state === 'Running' ? (
                  <Button variant="secondary" size="sm" onClick={() => void handleStopDaemon()}>
                    Stop Daemon
                  </Button>
                ) : (
                  <Button variant="primary" size="sm" onClick={() => void handleStartDaemon()}>
                    Start Daemon (In-Process)
                  </Button>
                )}

                <Button variant="secondary" size="sm" onClick={() => void handleInstallService()}>
                  Install Windows Service (SCM)
                </Button>

                <Button variant="ghost" size="sm" onClick={() => void handleUninstallService()}>
                  Uninstall Service
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                In-process daemon mode enables safe monitoring and testing without requiring Administrator elevation.
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: Device Compliance */}
        {activeTab === 'compliance' && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground">Compliance Policy Version</span>
                <div className="text-sm font-semibold text-foreground">
                  {compliance?.policy_version ?? '1.0.0'}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Overall Posture:</span>
                <StatusBadge
                  tone={
                    compliance?.overall_status === 'COMPLIANT'
                      ? 'ok'
                      : compliance?.overall_status === 'WARNING'
                        ? 'warn'
                        : 'danger'
                  }
                >
                  {compliance?.overall_status ?? 'UNKNOWN'}
                </StatusBadge>
              </div>
            </div>

            <div className="divide-y divide-border rounded-lg border border-border">
              {compliance?.results.map((rule) => (
                <div key={rule.rule_id} className="p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{rule.title}</span>
                    <StatusBadge
                      tone={
                        rule.status === 'PASS'
                          ? 'ok'
                          : rule.status === 'WARNING'
                            ? 'warn'
                            : 'danger'
                      }
                    >
                      {rule.status}
                    </StatusBadge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                    <div>
                      <span className="text-foreground/70">Observed: </span>
                      {rule.observed_value}
                    </div>
                    <div>
                      <span className="text-foreground/70">Expected: </span>
                      {rule.expected_value}
                    </div>
                  </div>
                  {rule.remediation && (
                    <div className="text-primary font-medium mt-1">
                      Remediation: {rule.remediation}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Component Integrity */}
        {activeTab === 'integrity' && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Cryptographic SHA-256 Component Manifest
              </span>
              <StatusBadge tone={integrity?.overall_valid ? 'ok' : 'danger'}>
                {integrity?.overall_valid ? 'ALL VALID' : 'TAMPER DETECTED'}
              </StatusBadge>
            </div>

            <div className="divide-y divide-border rounded-lg border border-border">
              {integrity?.components.map((comp) => (
                <div key={comp.component_name} className="p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{comp.component_name}</span>
                    <StatusBadge
                      tone={
                        comp.status === 'VALID'
                          ? 'ok'
                          : comp.status === 'FILE_NOT_FOUND'
                            ? 'warn'
                            : 'danger'
                      }
                    >
                      {comp.status}
                    </StatusBadge>
                  </div>
                  <div className="text-muted-foreground font-mono truncate text-[11px]">
                    Path: {comp.file_path}
                  </div>
                  {comp.actual_sha256 && (
                    <div className="text-muted-foreground font-mono truncate text-[11px]">
                      SHA-256: {comp.actual_sha256}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: Tamper & Recovery */}
        {activeTab === 'tamper' && (
          <div className="space-y-4 pt-2">
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  Cross-Process Recovery Limits
                </span>
                <StatusBadge tone={recovery?.lockout_active ? 'danger' : 'ok'}>
                  {recovery?.lockout_active ? 'ADMIN LOCKOUT ACTIVE' : 'NOMINAL'}
                </StatusBadge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  Restarts in window:{' '}
                  <span className="font-semibold text-foreground">
                    {recovery?.restart_count ?? 0} / {recovery?.max_restarts ?? 3}
                  </span>
                </div>
                <div>
                  Cooldown window:{' '}
                  <span className="font-semibold text-foreground">
                    {(recovery?.cooldown_seconds ?? 600) / 60} minutes
                  </span>
                </div>
              </div>
              {recovery?.lockout_active && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleResetRecovery()}
                  className="mt-2"
                >
                  Reset Recovery Lockout
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-foreground">
                Recorded Tamper &amp; Security Events
              </span>
              {tamperEvents.length === 0 ? (
                <div className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
                  No tampering or unauthorized modification events recorded.
                </div>
              ) : (
                <div className="divide-y divide-border rounded-lg border border-border max-h-60 overflow-y-auto">
                  {tamperEvents.map((ev) => (
                    <div key={ev.eventId} className="p-2.5 text-xs flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-foreground">{ev.tamperType}</div>
                        <div className="text-muted-foreground">{ev.description}</div>
                      </div>
                      <StatusBadge
                        tone={
                          ev.severity === 'CRITICAL' || ev.severity === 'HIGH'
                            ? 'danger'
                            : ev.severity === 'MEDIUM'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {ev.severity}
                      </StatusBadge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
