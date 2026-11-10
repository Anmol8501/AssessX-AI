import { useEffect, useState, type ReactNode } from 'react'
import { AlertIcon, CheckIcon, LockIcon, RefreshIcon, ShieldIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, StatusBadge } from '@/components/ui'
import { useApi } from '@/features/session'
import {
  getChangeJournal,
  getDeviceIdentity,
  getDiagnosticReport,
  getProvisioningPlan,
  inspectCandidateAccount,
  reEnrollDeviceIdentity,
  runFullDeviceScan,
  validateConfiguration,
} from './provisioning'
import type {
  BackendDeviceRecord,
  CandidateAccountStatus,
  ChangeJournal,
  ConfigurationValidationReport,
  DeviceIdentity,
  FullDeviceReadinessScan,
  InstallationDiagnosticReport,
  ProvisioningPlan,
} from './types'

export function DeviceReadinessCard() {
  const api = useApi()
  const [scan, setScan] = useState<FullDeviceReadinessScan | null>(null)
  const [identity, setIdentity] = useState<DeviceIdentity | null>(null)
  const [accountStatus, setAccountStatus] = useState<CandidateAccountStatus | null>(null)
  const [provisioningPlan, setProvisioningPlan] = useState<ProvisioningPlan | null>(null)
  const [validation, setValidation] = useState<ConfigurationValidationReport | null>(null)
  const [journal, setJournal] = useState<ChangeJournal | null>(null)

  const [loading, setLoading] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [registeredRecord, setRegisteredRecord] = useState<BackendDeviceRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'readiness' | 'identity' | 'account' | 'validation' | 'diagnostics'>('readiness')

  async function refreshAll() {
    setLoading(true)
    setError(null)
    try {
      const [scanRes, idRes, accRes, planRes, valRes, jourRes] = await Promise.all([
        runFullDeviceScan(),
        getDeviceIdentity(),
        inspectCandidateAccount('AssessXCandidate'),
        getProvisioningPlan('AssessXCandidate'),
        validateConfiguration(),
        getChangeJournal(),
      ])
      setScan(scanRes)
      setIdentity(idRes)
      setAccountStatus(accRes)
      setProvisioningPlan(planRes)
      setValidation(valRes)
      setJournal(jourRes)
    } catch {
      setError('Failed to scan device readiness metrics.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshAll()
  }, [])

  async function handleRegisterDevice() {
    if (!identity) return
    setRegistering(true)
    setError(null)
    try {
      const res = await api<BackendDeviceRecord>('/api/v1/devices/register', {
        method: 'POST',
        body: {
          device_identifier: identity.deviceId,
          hostname: identity.hostname,
          platform: identity.platform,
          os_edition: scan?.compatibility.edition ?? null,
          os_build: scan ? `${scan.compatibility.buildNumber}.${scan.compatibility.ubr}` : null,
        },
      })
      setRegisteredRecord(res)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Device registration request failed.'
      setError(msg)
    } finally {
      setRegistering(false)
    }
  }

  async function handleReEnroll() {
    setLoading(true)
    try {
      const newId = await reEnrollDeviceIdentity()
      setIdentity(newId)
      setRegisteredRecord(null)
    } catch {
      setError('Failed to re-enroll device identity.')
    } finally {
      setLoading(false)
    }
  }

  async function handleExportDiagnostics() {
    try {
      const report: InstallationDiagnosticReport = await getDiagnosticReport('AssessXCandidate')
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `assessx-diagnostics-${report.diagnosticId}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      setError('Failed to generate diagnostic report export.')
    }
  }

  const tone =
    scan?.overallReadiness === 'READY'
      ? 'ok'
      : scan?.overallReadiness === 'READY_WITH_WARNINGS'
        ? 'warn'
        : 'danger'

  const label =
    scan?.overallReadiness === 'READY'
      ? 'Fully Ready'
      : scan?.overallReadiness === 'READY_WITH_WARNINGS'
        ? 'Ready with Advisories'
        : 'Action Required'

  return (
    <Card>
      <CardHeader
        title="Windows Provisioning & Device Readiness"
        description="Hardware inspection, security controls, device identity enrollment, and candidate account provisioning (Phase 1A)."
        actions={
          <div className="flex items-center gap-2">
            {scan && (
              <StatusBadge tone={tone} dot>
                {label}
              </StatusBadge>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refreshAll()}
              disabled={loading}
              leadingIcon={<RefreshIcon className={loading ? 'animate-spin' : ''} />}
            >
              {loading ? 'Scanning…' : 'Rescan'}
            </Button>
          </div>
        }
      />

      {/* Navigation Sub-Tabs */}
      <div className="border-b border-line px-5 flex gap-4 text-[13px] font-medium">
        <button
          type="button"
          onClick={() => setActiveTab('readiness')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeTab === 'readiness'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Readiness Metrics
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('identity')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeTab === 'identity'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Device Identity
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('account')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeTab === 'account'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Candidate Account
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('validation')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeTab === 'validation'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Configuration Integrity
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('diagnostics')}
          className={`py-2.5 border-b-2 transition-colors ${
            activeTab === 'diagnostics'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-ink-subtle hover:text-ink'
          }`}
        >
          Diagnostics & Audit
        </button>
      </div>

      <CardBody className="space-y-6">
        {loading && !scan ? (
          <div className="flex h-32 items-center justify-center text-ink-subtle text-[13px]">
            <RefreshIcon className="mr-2 animate-spin text-[16px] text-accent" />
            Evaluating Windows system, hardware, and security readiness…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-4 text-[13px] text-danger">
            {error}
          </div>
        ) : !scan ? null : (
          <>
            {/* TAB 1: READINESS METRICS */}
            {activeTab === 'readiness' && (
              <div className="space-y-6">
                {/* 1. Windows Compatibility (Module 1) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 border-b border-line pb-1.5">
                    <ShieldIcon className="text-accent text-[15px]" />
                    <h4 className="text-[13.5px] font-semibold text-ink">Operating System & Compatibility</h4>
                    <StatusBadge
                      tone={
                        scan.compatibility.compatibility === 'SUPPORTED'
                          ? 'ok'
                          : scan.compatibility.compatibility === 'WARNING'
                            ? 'warn'
                            : 'danger'
                      }
                      className="ml-auto text-[11px]"
                    >
                      {scan.compatibility.compatibility}
                    </StatusBadge>
                  </div>
                  <p className="text-[12.5px] text-ink-muted leading-relaxed">
                    {scan.compatibility.summary}
                  </p>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12.5px] pt-1">
                    <MetricItem label="Windows Edition" value={scan.compatibility.edition} />
                    <MetricItem
                      label="Version / Build"
                      value={`${scan.compatibility.displayVersion} (${scan.compatibility.buildNumber}.${scan.compatibility.ubr})`}
                    />
                    <MetricItem label="Architecture" value={scan.compatibility.architecture.toUpperCase()} />
                    <MetricItem
                      label="Kiosk Capable"
                      value={scan.compatibility.kioskSupported ? 'Supported' : 'Standard Only'}
                      ok={scan.compatibility.kioskSupported}
                    />
                  </dl>
                  {scan.compatibility.warnings.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {scan.compatibility.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-[12px] text-amber-700 dark:text-amber-300">
                          <AlertIcon className="mt-0.5 shrink-0 text-[13px]" />
                          <span>{w}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. Hardware Readiness (Module 2) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 border-b border-line pb-1.5">
                    <span className="font-mono text-[12px] font-bold text-accent">HW</span>
                    <h4 className="text-[13.5px] font-semibold text-ink">Hardware Capacity & Peripherals</h4>
                    <StatusBadge
                      tone={
                        scan.hardware.overallStatus === 'PASS'
                          ? 'ok'
                          : scan.hardware.overallStatus === 'WARNING'
                            ? 'warn'
                            : 'danger'
                      }
                      className="ml-auto text-[11px]"
                    >
                      {scan.hardware.overallStatus}
                    </StatusBadge>
                  </div>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12.5px]">
                    <MetricItem
                      label="Processor (CPU)"
                      value={scan.hardware.cpu.message}
                      ok={scan.hardware.cpu.status === 'PASS'}
                      warn={scan.hardware.cpu.status === 'WARNING'}
                    />
                    <MetricItem
                      label="Physical Memory (RAM)"
                      value={scan.hardware.memory.message}
                      ok={scan.hardware.memory.status === 'PASS'}
                      warn={scan.hardware.memory.status === 'WARNING'}
                    />
                    <MetricItem
                      label="System Storage (Disk)"
                      value={scan.hardware.storage.message}
                      ok={scan.hardware.storage.status === 'PASS'}
                      warn={scan.hardware.storage.status === 'WARNING'}
                    />
                    <MetricItem
                      label="Displays / Topology"
                      value={scan.hardware.display.message}
                      ok={scan.hardware.display.status === 'PASS'}
                      warn={scan.hardware.display.status === 'WARNING'}
                    />
                  </dl>
                </div>

                {/* 3. Windows Security & Firmware (Module 3) */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 border-b border-line pb-1.5">
                    <span className="font-mono text-[12px] font-bold text-accent">SEC</span>
                    <h4 className="text-[13.5px] font-semibold text-ink">Firmware & OS Security Controls</h4>
                    <StatusBadge
                      tone={
                        scan.security.overallStatus === 'PASS'
                          ? 'ok'
                          : scan.security.overallStatus === 'WARNING'
                            ? 'warn'
                            : 'danger'
                      }
                      className="ml-auto text-[11px]"
                    >
                      {scan.security.overallStatus}
                    </StatusBadge>
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12.5px]">
                    <MetricItem
                      label={scan.security.secureBoot.name}
                      value={scan.security.secureBoot.value}
                      ok={scan.security.secureBoot.status === 'PASS'}
                      warn={scan.security.secureBoot.status === 'WARNING'}
                    />
                    <MetricItem
                      label={scan.security.tpm.name}
                      value={scan.security.tpm.value}
                      ok={scan.security.tpm.status === 'PASS'}
                      warn={scan.security.tpm.status === 'WARNING'}
                    />
                    <MetricItem
                      label={scan.security.firewall.name}
                      value={scan.security.firewall.value}
                      ok={scan.security.firewall.status === 'PASS'}
                      warn={scan.security.firewall.status === 'WARNING'}
                    />
                    <MetricItem
                      label={scan.security.antivirus.name}
                      value={scan.security.antivirus.value}
                      ok={scan.security.antivirus.status === 'PASS'}
                      warn={scan.security.antivirus.status === 'WARNING'}
                    />
                  </dl>
                </div>

                {/* 4. Execution Privileges (Module 4) */}
                <div className="rounded-lg border border-line bg-surface/50 p-3 text-[12.5px]">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-ink">Process Elevation: </span>
                      <span className={scan.privileges.isElevated ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-ink-muted'}>
                        {scan.privileges.privilegeLevel}
                      </span>
                      <span className="text-ink-subtle"> ({scan.privileges.userName})</span>
                    </div>
                    <StatusBadge tone={scan.privileges.isElevated ? 'ok' : 'neutral'} dot>
                      {scan.privileges.isElevated ? 'Elevated' : 'Standard'}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-[11.5px] text-ink-subtle leading-normal">
                    {scan.privileges.summary}
                  </p>
                </div>
              </div>
            )}

            {/* TAB 2: DEVICE IDENTITY & REGISTRATION (Modules 6 & 7) */}
            {activeTab === 'identity' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-line bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[13.5px] font-semibold text-ink">AssessX Cryptographic Device Identity</h4>
                    <Button variant="secondary" size="sm" onClick={() => void handleReEnroll()} disabled={loading}>
                      Re-enroll ID
                    </Button>
                  </div>
                  <p className="text-[12.5px] text-ink-muted leading-relaxed">
                    A persistent cryptographic thumbprint stored locally in application data across reboots. Used to authenticate and authorize this physical workstation.
                  </p>
                  {identity && (
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12.5px] pt-1">
                      <MetricItem label="Device Thumbprint (ID)" value={<span className="font-mono text-[11.5px]">{identity.deviceId}</span>} />
                      <MetricItem label="Workstation Hostname" value={identity.hostname} />
                      <MetricItem label="Platform" value={identity.platform} />
                      <MetricItem label="Identity Created" value={new Date(identity.createdAt).toLocaleString()} />
                    </dl>
                  )}
                </div>

                {/* Backend Server Registration Status */}
                <div className="rounded-lg border border-line bg-surface/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-[13.5px] font-semibold text-ink">Backend Server Registration</h4>
                      <p className="text-[12px] text-ink-subtle">
                        Synchronizes this workstation with the centralized AssessX security registry.
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void handleRegisterDevice()}
                      disabled={registering}
                      leadingIcon={registering ? <RefreshIcon className="animate-spin" /> : <ShieldIcon />}
                    >
                      {registering ? 'Registering…' : registeredRecord ? 'Update Registry' : 'Register Workstation'}
                    </Button>
                  </div>

                  {registeredRecord ? (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-[12.5px] text-emerald-800 dark:text-emerald-300 space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold">
                        <CheckIcon className="text-[14px]" />
                        <span>Workstation Registered Successfully</span>
                      </div>
                      <p className="text-[11.5px]">
                        Database ID: <span className="font-mono">{registeredRecord.id}</span> · Status: {registeredRecord.status}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[12px] text-ink-subtle">
                      This workstation has not yet reported to the backend device registry during this session.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: CANDIDATE ACCOUNT (Module 5) */}
            {activeTab === 'account' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-line bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-[13.5px] font-semibold text-ink">Windows Candidate Account Inspection</h4>
                      <p className="text-[12px] text-ink-subtle">
                        Non-destructive inspection of local account isolation for Secure Exam Mode.
                      </p>
                    </div>
                    {accountStatus && (
                      <StatusBadge
                        tone={
                          accountStatus.status === 'READY'
                            ? 'ok'
                            : accountStatus.status === 'WARNING_IS_ADMIN'
                              ? 'danger'
                              : 'warn'
                        }
                      >
                        {accountStatus.status}
                      </StatusBadge>
                    )}
                  </div>

                  {accountStatus && (
                    <div className="rounded-md border border-line/60 bg-surface/30 p-3 text-[12.5px]">
                      <p className="font-medium text-ink">{accountStatus.message}</p>
                      <div className="mt-2 flex gap-4 text-[12px] text-ink-subtle">
                        <span>Account: <strong>{accountStatus.accountName}</strong></span>
                        <span>Exists: <strong>{accountStatus.exists ? 'Yes' : 'No'}</strong></span>
                        <span>Admin Rights: <strong>{accountStatus.isAdministrator ? 'Yes (Prohibited)' : 'No (Correct)'}</strong></span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Provisioning Plan */}
                {provisioningPlan && (
                  <div className="rounded-lg border border-line bg-surface/40 p-4 space-y-3">
                    <h4 className="text-[13.5px] font-semibold text-ink">Generated Provisioning Plan</h4>
                    <p className="text-[12.5px] text-ink-muted">
                      Recommendation: <strong>{provisioningPlan.recommendedAction}</strong>
                    </p>
                    <div className="space-y-2 pt-1">
                      {provisioningPlan.steps.map((s) => (
                        <div key={s.stepNumber} className="rounded-md border border-line bg-card p-2.5 text-[12px]">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-ink">Step {s.stepNumber}: {s.title}</span>
                            <span className="text-[11px] text-ink-subtle">
                              {s.requiresElevation ? 'Requires Elevation' : 'Standard'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-ink-subtle">{s.description}</p>
                          {s.command && (
                            <code className="mt-1 block rounded bg-slate-900 px-2 py-1 text-[11px] text-slate-100 font-mono">
                              {s.command}
                            </code>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-[11.5px] text-ink-subtle italic">
                      * In accordance with AssessX safety rules, provisioning commands are never executed automatically without explicit administrator consent.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: CONFIGURATION VALIDATION (Module 8) */}
            {activeTab === 'validation' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-line bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[13.5px] font-semibold text-ink">Installation Integrity & Environment Validation</h4>
                    {validation && (
                      <StatusBadge tone={validation.overallStatus === 'READY' ? 'ok' : 'warn'}>
                        {validation.overallStatus}
                      </StatusBadge>
                    )}
                  </div>
                  <p className="text-[12.5px] text-ink-muted">
                    {validation?.summary}
                  </p>
                  <div className="space-y-2 pt-1">
                    {validation?.checks.map((c, i) => (
                      <div key={i} className="flex items-center justify-between rounded-md border border-line/60 bg-surface/30 p-2.5 text-[12.5px]">
                        <div>
                          <span className="font-medium text-ink">{c.name}</span>
                          <p className="text-[11.5px] text-ink-subtle">{c.details}</p>
                        </div>
                        <StatusBadge tone={c.status === 'PASS' ? 'ok' : c.status === 'WARNING' ? 'warn' : 'danger'}>
                          {c.status}
                        </StatusBadge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: DIAGNOSTICS & CHANGE JOURNAL (Modules 9 & 10) */}
            {activeTab === 'diagnostics' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-line bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-[13.5px] font-semibold text-ink">Scrubbed Installation Diagnostics</h4>
                      <p className="text-[12px] text-ink-subtle">
                        Exports complete environment, hardware, and security state with all tokens and PII scrubbed.
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => void handleExportDiagnostics()}>
                      Download Diagnostics (JSON)
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-line bg-surface/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <LockIcon className="text-accent text-[15px]" />
                      <h4 className="text-[13.5px] font-semibold text-ink">Safe Rollback Foundation & Change Journal</h4>
                    </div>
                    <span className="text-[11.5px] text-ink-subtle">
                      {journal?.entries.length ?? 0} entries recorded
                    </span>
                  </div>
                  <p className="text-[12px] text-ink-subtle">
                    AssessX enforces an append-only JSON journal to track every system-level modification and maintain safe, deterministic rollback plans.
                  </p>
                  {journal && journal.entries.length > 0 ? (
                    <div className="space-y-2">
                      {journal.entries.map((entry) => (
                        <div key={entry.entryId} className="rounded border border-line bg-card p-2 text-[11.5px]">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-ink">{entry.operation}</span>
                            <StatusBadge tone="neutral">{entry.status}</StatusBadge>
                          </div>
                          <p className="text-ink-subtle mt-0.5">Target: {entry.targetResource}</p>
                          {entry.rollbackCommand && (
                            <code className="mt-1 block text-[10.5px] font-mono text-ink-subtle">
                              Rollback: {entry.rollbackCommand}
                            </code>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11.5px] text-ink-subtle italic">
                      No system modifications have been performed on this host. Machine remains in pristine initial state.
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
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
