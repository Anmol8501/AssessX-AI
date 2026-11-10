import { useState } from 'react'
import { AlertIcon, CheckIcon, ClockIcon, LockIcon, RefreshIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader } from '@/components/ui'
import { runNativeReadiness, type PreFlightReadinessReport } from '@/features/exam/sessionActivation'

export function ExamAuthorizationCard() {
  const [report, setReport] = useState<PreFlightReadinessReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastCheckTime, setLastCheckTime] = useState<string | null>(null)

  async function handleTestReadiness() {
    setBusy(true)
    try {
      const res = await runNativeReadiness()
      setReport(res)
      setLastCheckTime(new Date().toLocaleTimeString())
    } catch {
      // Handled in report state
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Examination Authorization & Pre-Flight Readiness"
        description="Phase 3A: Validates candidate eligibility, device authorization, and multi-layer OS security before issuing 120s activation tokens."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleTestReadiness()}
            loading={busy}
            leadingIcon={<RefreshIcon />}
          >
            Run Pre-Flight Scan
          </Button>
        }
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="bg-canvas-subtle/50 p-3 rounded-lg border border-panel/50">
            <span className="text-ink-subtle text-xs block">Authorization Mode</span>
            <span className="text-ink font-medium text-sm flex items-center gap-1.5 mt-0.5">
              <LockIcon className="text-primary text-xs" />
              Backend Enforced
            </span>
          </div>

          <div className="bg-canvas-subtle/50 p-3 rounded-lg border border-panel/50">
            <span className="text-ink-subtle text-xs block">Token TTL</span>
            <span className="text-ink font-medium text-sm flex items-center gap-1.5 mt-0.5">
              <ClockIcon className="text-warning text-xs" />
              120 Seconds
            </span>
          </div>

          <div className="bg-canvas-subtle/50 p-3 rounded-lg border border-panel/50">
            <span className="text-ink-subtle text-xs block">Active Policy Version</span>
            <span className="text-ink font-medium text-sm mt-0.5 block">v1.0 (Standard)</span>
          </div>

          <div className="bg-canvas-subtle/50 p-3 rounded-lg border border-panel/50">
            <span className="text-ink-subtle text-xs block">Last Workstation Scan</span>
            <span className="text-ink font-medium text-sm mt-0.5 block">
              {lastCheckTime ?? 'Not checked yet'}
            </span>
          </div>
        </div>

        {report && (
          <div className="border border-panel rounded-lg overflow-hidden divide-y divide-panel/40">
            <div className="bg-canvas-subtle px-4 py-2 flex items-center justify-between text-xs font-medium">
              <span className="flex items-center gap-1.5">
                Overall Workstation Readiness:
                <span
                  className={`font-semibold uppercase ${
                    report.overall_status === 'READY'
                      ? 'text-success'
                      : report.overall_status === 'WARNING'
                      ? 'text-warning'
                      : 'text-danger'
                  }`}
                >
                  {report.overall_status}
                </span>
              </span>
              <span className="text-ink-subtle">
                Device: <code className="font-mono text-ink text-[11px]">{report.device_identifier.slice(0, 16)}…</code>
              </span>
            </div>

            <div className="divide-y divide-panel/30">
              {report.checks.map((check) => {
                const isReady = check.status === 'READY'
                const isWarning = check.status === 'WARNING'
                return (
                  <div key={check.check_id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      {isReady ? (
                        <CheckIcon className="text-success text-sm shrink-0" />
                      ) : isWarning ? (
                        <ClockIcon className="text-warning text-sm shrink-0" />
                      ) : (
                        <AlertIcon className="text-danger text-sm shrink-0" />
                      )}
                      <div>
                        <span className="font-medium text-ink">{check.check_id}</span>
                        <span className="text-ink-subtle ml-2 text-[11px]">({check.category})</span>
                        <p className="text-ink-muted text-[11px] mt-0.5">{check.message}</p>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded ${
                        isReady
                          ? 'bg-success/10 text-success'
                          : isWarning
                          ? 'bg-warning/10 text-warning'
                          : 'bg-danger/10 text-danger'
                      }`}
                    >
                      {check.status}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

