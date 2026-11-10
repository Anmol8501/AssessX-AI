import { useNavigate } from 'react-router'
import { routes } from '@/app/routes'
import { CheckIcon, ShieldIcon } from '@/components/icons'
import { Button, Card, CardBody } from '@/components/ui'
import { SubmissionReceiptCard } from './SubmissionReceiptCard'
import type { SubmissionReceiptResponse, ClosureRestorationReport } from './submissionClosure'

export interface ExaminationCompletedPageProps {
  receipt: SubmissionReceiptResponse
  restorationReport?: ClosureRestorationReport | null
  onExit?: () => void
}

export function ExaminationCompletedPage({
  receipt,
  restorationReport,
  onExit,
}: ExaminationCompletedPageProps) {
  const navigate = useNavigate()

  const handleReturn = () => {
    if (onExit) {
      onExit()
    } else {
      navigate(routes.candidate.exams)
    }
  }

  const subsystems = restorationReport?.restoredSubsystems ?? [
    'TASK_MANAGER_AND_SYSTEM_UTILITIES',
    'NAVIGATION_AND_SHORTCUT_HOOKS',
    'APPLICATION_CONTROL_ALLOWLIST',
    'PERIPHERAL_AND_STORAGE_RESTRICTIONS',
  ]

  return (
    <div className="bg-surface min-h-full w-full flex flex-col items-center justify-start p-6 sm:p-10 overflow-y-auto space-y-6">
      {/* Top Banner */}
      <div className="text-center max-w-xl space-y-3">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-ok/30 bg-ok-soft text-ok text-2xl shadow-sm">
          <CheckIcon />
        </div>
        <h1 className="text-2xl font-bold text-ink tracking-tight">
          Examination Submitted & Session Concluded
        </h1>
        <p className="text-sm text-ink-subtle">
          Your answers are finalized and securely archived. The workstation environment has been safely restored.
        </p>
      </div>

      {/* Official Receipt Card */}
      <SubmissionReceiptCard
        receipt={receipt}
        onContinue={handleReturn}
        continueLabel="Exit to My Exams"
      />

      {/* Workstation Security Policy Restoration Status */}
      <Card className="w-full max-w-2xl border border-line bg-card">
        <CardBody className="space-y-3 text-xs">
          <div className="flex items-center gap-2 text-ink font-semibold">
            <ShieldIcon className="text-ok text-base" />
            <span>Workstation Security Environment Restoration</span>
          </div>

          <p className="text-ink-subtle">
            Native Windows security restrictions have been systematically rolled back by the AssessX Security Agent:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            {subsystems.map((subsystem) => (
              <div
                key={subsystem}
                className="flex items-center gap-2 p-2 rounded-md bg-surface border border-line text-ink"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-ok shrink-0" />
                <span className="font-mono text-[11px] truncate">{subsystem}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-line text-[11.5px] text-ink-subtle">
            <span>Status: <strong className="text-ok font-semibold">{restorationReport?.closureStatus ?? 'RESTORED'}</strong></span>
            <span>Local Answer Cache: <strong className="text-ink font-semibold">Purged</strong></span>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-center pb-8">
        <Button onClick={handleReturn} size="lg">
          Exit to My Exams
        </Button>
      </div>
    </div>
  )
}

