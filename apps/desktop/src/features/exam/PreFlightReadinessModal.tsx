import { useEffect, useState } from 'react'
import { AlertIcon, CheckIcon, ClockIcon, LockIcon, RefreshIcon } from '@/components/icons'
import { Button } from '@/components/ui'
import {
  checkCandidateEligibility,
  runNativeReadiness,
  requestStartAuthorization,
  bindNativeSessionPolicy,
  activateAuthorizedSession,
  type PreFlightReadinessReport,
  type SecurityReadinessCheckItem,
} from './sessionActivation'

interface PreFlightReadinessModalProps {
  open: boolean
  examId: string
  examTitle: string
  proctored?: boolean
  onClose: () => void
  onAuthorized: () => void
}

type ScanPhase = 'idle' | 'scanning' | 'ready' | 'blocked' | 'authorizing' | 'success'

export function PreFlightReadinessModal({
  open,
  examId,
  examTitle,
  proctored = false,
  onClose,
  onAuthorized,
}: PreFlightReadinessModalProps) {
  const [phase, setPhase] = useState<ScanPhase>('idle')
  const [report, setReport] = useState<PreFlightReadinessReport | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function executeReadinessScan() {
    setPhase('scanning')
    setErrorMessage(null)

    try {
      // Step 1: Query backend eligibility
      const eligibility = await checkCandidateEligibility(examId)
      if (!eligibility.eligible) {
        setPhase('blocked')
        setErrorMessage(eligibility.user_message || 'Candidate is not eligible to start this examination.')
        return
      }

      // Step 2: Query desktop native readiness
      const nativeReport = await runNativeReadiness()

      // Merge candidate check
      const candidateCheck: SecurityReadinessCheckItem = {
        check_id: 'candidate_eligibility',
        category: 'Identity',
        status: 'READY',
        mandatory: true,
        message: `Eligibility confirmed (Attempt ${eligibility.attempts_used + 1} of ${eligibility.max_attempts})`,
      }

      const mergedChecks = [candidateCheck, ...nativeReport.checks]
      const hasBlocker = mergedChecks.some(
        (c) => c.mandatory && (c.status === 'NOT_READY' || c.status === 'VERIFICATION_FAILED')
      )

      const finalReport: PreFlightReadinessReport = {
        ...nativeReport,
        checks: mergedChecks,
        overall_status: hasBlocker ? 'NOT_READY' : 'READY',
      }

      setReport(finalReport)
      setPhase(hasBlocker ? 'blocked' : 'ready')
    } catch (err: unknown) {
      setPhase('blocked')
      setErrorMessage(err instanceof Error ? err.message : 'Failed to complete pre-flight security readiness evaluation.')
    }
  }

  useEffect(() => {
    if (open) {
      void executeReadinessScan()
    }
  }, [open, examId])

  async function handleAuthorizeAndStart() {
    if (!report) return
    setPhase('authorizing')
    setErrorMessage(null)

    try {
      // 1. Request signed authorization token from backend
      const authRes = await requestStartAuthorization(examId, report)
      if (!authRes.authorized) {
        throw new Error(authRes.user_message || 'Backend denied start authorization.')
      }

      // 2. Bind session policy with Security Agent Named Pipe
      await bindNativeSessionPolicy(
        authRes.authorization_id,
        authRes.policy_version,
        examId
      )

      // 3. For non-proctored exams, activate immediately; proctored exams start
      // their attempt and clock only after the camera/mic check passes.
      if (!proctored) {
        await activateAuthorizedSession(
          examId,
          authRes.activation_token,
          report.device_identifier
        )
      }

      setPhase('success')
      setTimeout(() => {
        onAuthorized()
      }, 600)
    } catch (err: unknown) {
      setPhase('blocked')
      setErrorMessage(err instanceof Error ? err.message : 'Authorization request failed.')
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="readiness-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="bg-canvas border-panel text-ink w-full max-w-2xl rounded-xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="border-b border-panel px-6 py-4 flex items-center justify-between">
          <div>
            <h2 id="readiness-title" className="text-base font-semibold text-ink flex items-center gap-2">
              <LockIcon className="text-primary text-lg" />
              Pre-Flight Examination Security Readiness
            </h2>
            <p className="text-ink-subtle text-xs mt-0.5">{examTitle}</p>
          </div>
          {phase === 'scanning' && (
            <span className="text-xs bg-primary/10 text-primary px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 animate-pulse">
              <RefreshIcon className="animate-spin text-sm" />
              Scanning Workstation…
            </span>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {errorMessage && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg p-3.5 flex items-start gap-3 text-xs text-danger">
              <AlertIcon className="shrink-0 text-base mt-0.5" />
              <div>
                <p className="font-semibold">Security Readiness Attention Required</p>
                <p className="mt-0.5 opacity-90">{errorMessage}</p>
              </div>
            </div>
          )}

          {phase === 'scanning' && !report && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <RefreshIcon className="text-primary text-3xl animate-spin" />
              <p className="text-sm font-medium">Validating Windows Security Environment…</p>
              <p className="text-xs text-ink-subtle max-w-sm">
                Checking Security Agent health, display configuration, execution allowlists, and eligibility.
              </p>
            </div>
          )}

          {report && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-ink-subtle border-b border-panel/50 pb-2">
                <span>Device ID: <code className="font-mono text-ink text-[11px]">{report.device_identifier.slice(0, 16)}…</code></span>
                <span>Agent Protocol: v{report.agent_version}</span>
              </div>

              <div className="divide-y divide-panel/40 border border-panel/50 rounded-lg overflow-hidden">
                {report.checks.map((check) => {
                  const isReady = check.status === 'READY'
                  const isWarning = check.status === 'WARNING'
                  return (
                    <div key={check.check_id} className="p-3 flex items-start justify-between gap-3 bg-canvas-subtle/30">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5">
                          {isReady ? (
                            <CheckIcon className="text-success text-base" />
                          ) : isWarning ? (
                            <ClockIcon className="text-warning text-base" />
                          ) : (
                            <AlertIcon className="text-danger text-base" />
                          )}
                        </span>
                        <div>
                          <p className="text-xs font-medium text-ink flex items-center gap-1.5">
                            {formatCheckTitle(check.check_id)}
                            {check.mandatory && <span className="text-[10px] text-primary/80 font-normal">[Required]</span>}
                          </p>
                          <p className="text-[11.5px] text-ink-muted mt-0.5">{check.message}</p>
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
        </div>

        {/* Modal Footer */}
        <div className="border-t border-panel px-6 py-3.5 bg-canvas-subtle/40 flex items-center justify-between">
          <Button variant="ghost" onClick={onClose} disabled={phase === 'authorizing'}>
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            {phase === 'blocked' && (
              <Button variant="secondary" onClick={() => void executeReadinessScan()} leadingIcon={<RefreshIcon />}>
                Re-scan Workstation
              </Button>
            )}

            <Button
              variant="primary"
              onClick={() => void handleAuthorizeAndStart()}
              disabled={phase !== 'ready'}
              loading={phase === 'authorizing'}
              leadingIcon={<LockIcon />}
            >
              {phase === 'success' ? 'Entering Secure Exam…' : 'Authorize & Start Exam'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatCheckTitle(checkId: string): string {
  switch (checkId) {
    case 'candidate_eligibility':
      return 'Candidate Eligibility & Schedule'
    case 'agent_health':
      return 'Security Agent IPC Health'
    case 'shell_kiosk':
      return 'Secure Shell Kiosk Container'
    case 'allowlist_enforcement':
      return 'Application Execution Allowlist'
    case 'utility_restrictions':
      return 'System Utility & PowerShell Lockdown'
    case 'hotkey_hook_active':
      return 'Navigation & Low-Level Keyboard Hooks'
    case 'single_monitor_check':
      return 'Display Topology & Virtual Monitors'
    case 'remote_tool_scanner':
      return 'Remote Access & Screen Sharing Scanner'
    default:
      return checkId.replace(/_/g, ' ')
  }
}

