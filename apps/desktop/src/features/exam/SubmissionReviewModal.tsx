import { useState } from 'react'
import { AlertIcon, CheckIcon, SpinnerIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader } from '@/components/ui'

export interface SubmissionReviewModalProps {
  open: boolean
  totalQuestions: number
  answeredQuestions: number
  isTimeout?: boolean
  isSubmitting: boolean
  submitError?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function SubmissionReviewModal({
  open,
  totalQuestions,
  answeredQuestions,
  isTimeout = false,
  isSubmitting,
  submitError,
  onConfirm,
  onCancel,
}: SubmissionReviewModalProps) {
  const [confirmedAcknowledgement, setConfirmedAcknowledgement] = useState(false)

  if (!open) return null

  const unanswered = Math.max(0, totalQuestions - answeredQuestions)
  const canSubmit = !isSubmitting && (isTimeout || confirmedAcknowledgement)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="submission-review-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <Card className="w-full max-w-lg shadow-2xl border border-line bg-card">
        <CardHeader
          title={isTimeout ? 'Time Expired — Final Submission' : 'Review & Submit Examination'}
          description={
            isTimeout
              ? 'The allotted examination time has elapsed. Please proceed with finalizing your submission.'
              : 'Please review your answering progress before finalizing your submission.'
          }
        />

        <CardBody className="space-y-5">
          {/* Progress summary stats */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 rounded-lg border border-line bg-surface/50">
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-subtle">
                Total
              </span>
              <p className="mt-1 text-2xl font-bold text-ink">{totalQuestions}</p>
              <span className="text-[11px] text-ink-subtle">Questions</span>
            </div>

            <div className="p-3 rounded-lg border border-line bg-ok-soft/30">
              <span className="text-[11px] font-medium uppercase tracking-wider text-ok">
                Answered
              </span>
              <p className="mt-1 text-2xl font-bold text-ok">{answeredQuestions}</p>
              <span className="text-[11px] text-ok">Completed</span>
            </div>

            <div
              className={`p-3 rounded-lg border ${
                unanswered > 0
                  ? 'border-amber-500/30 bg-amber-500/10'
                  : 'border-line bg-surface/50'
              }`}
            >
              <span
                className={`text-[11px] font-medium uppercase tracking-wider ${
                  unanswered > 0 ? 'text-amber-500' : 'text-ink-subtle'
                }`}
              >
                Unanswered
              </span>
              <p
                className={`mt-1 text-2xl font-bold ${
                  unanswered > 0 ? 'text-amber-500' : 'text-ink'
                }`}
              >
                {unanswered}
              </p>
              <span
                className={`text-[11px] ${unanswered > 0 ? 'text-amber-500' : 'text-ink-subtle'}`}
              >
                Remaining
              </span>
            </div>
          </div>

          {/* Unanswered warning banner */}
          {unanswered > 0 && !isTimeout && (
            <div className="flex items-start gap-3 p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">
              <AlertIcon className="mt-0.5 shrink-0 text-base" />
              <div>
                <p className="font-semibold">You have {unanswered} unanswered question{unanswered > 1 ? 's' : ''}.</p>
                <p className="mt-0.5 text-amber-600/90 dark:text-amber-400/90">
                  Unanswered questions will receive 0 marks. You can return to the examination to answer them before submitting.
                </p>
              </div>
            </div>
          )}

          {/* All answered confirmation banner */}
          {unanswered === 0 && (
            <div className="flex items-center gap-2.5 p-3 rounded-lg border border-ok/30 bg-ok-soft/20 text-ok text-xs">
              <CheckIcon className="shrink-0 text-base" />
              <span className="font-medium">
                All questions have been answered and synchronized with the examination server.
              </span>
            </div>
          )}

          {/* Error alert if submission failed */}
          {submitError && (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-danger/30 bg-danger/10 text-danger text-xs">
              <AlertIcon className="shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Candidate explicit confirmation checkbox (if not timed out) */}
          {!isTimeout && (
            <label className="flex items-start gap-2.5 cursor-pointer text-xs select-none">
              <input
                type="checkbox"
                checked={confirmedAcknowledgement}
                onChange={(e) => setConfirmedAcknowledgement(e.target.checked)}
                disabled={isSubmitting}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
              />
              <span className="text-ink leading-relaxed">
                I understand that once I confirm, my answers will be committed cryptographically, an authoritative receipt will be issued, and the examination session will close permanently.
              </span>
            </label>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-line">
            {!isTimeout && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Return to Exam
              </Button>
            )}

            <Button
              size="sm"
              onClick={onConfirm}
              disabled={!canSubmit}
              leadingIcon={isSubmitting ? <SpinnerIcon /> : undefined}
            >
              {isSubmitting ? 'Committing Submission…' : 'Confirm & Submit'}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

