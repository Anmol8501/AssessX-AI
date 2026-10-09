import { AlertIcon, LockIcon } from '@/components/icons'
import { Button } from '@/components/ui'
import type { AttemptControl, ProctorMessage } from '@/features/exam/types'
import { EXAM_RULES, aiWarningMessage } from './examRules'
import type { TabSwitchWarning } from './useAttemptControl'

/**
 * What the candidate sees of the exam rules while answering:
 * * a warning each time they leave the exam window (tab switch) — "Warning 1 of 2";
 * * a full-screen lock when the exam is on hold (the third switch, or an administrator);
 * * plain instructions while the camera AI observes something (no face, more than one person…).
 *
 * The wording states the rule and its consequence; it never accuses.
 */

export function ExamRules({ className }: { className?: string }) {
  return (
    <div className={className} aria-label="Exam rules">
      <p className="text-ink text-[13.5px] font-semibold">Exam rules</p>
      <ul className="mt-2 space-y-1.5">
        {EXAM_RULES.map((rule) => (
          <li key={rule.title} className="text-[13px]">
            <span className="text-ink font-medium">{rule.title}.</span> <span className="text-ink-muted">{rule.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Instructions while the camera AI observes something. They clear when it no longer does. */
export function AIWarnings({ conditions }: { conditions: string[] }) {
  const messages = conditions.map(aiWarningMessage).filter((m): m is string => m !== null)
  if (messages.length === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex flex-col items-center gap-2 px-4" aria-live="assertive">
      {messages.map((message) => (
        <div
          key={message}
          role="alert"
          className="flex max-w-lg items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 shadow-md"
        >
          <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
          <span>
            {message} <span className="text-amber-700">The exam supervisor is notified.</span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** Shown after the candidate returns from leaving the exam window (the first and second times). */
export function TabSwitchWarningDialog({ warning, onClose }: { warning: TabSwitchWarning; onClose(): void }) {
  const last = warning.number >= warning.allowed
  return (
    <div className="bg-ink/60 fixed inset-0 z-50 flex items-center justify-center p-6" role="alertdialog" aria-labelledby="tab-switch-warning">
      <div className="bg-card w-full max-w-md rounded-lg px-6 py-6 text-center shadow-xl">
        <AlertIcon className="text-danger mx-auto text-[28px]" />
        <h2 id="tab-switch-warning" className="text-ink mt-2 text-[16px] font-semibold">
          Warning {warning.number} of {warning.allowed}: you left the exam window
        </h2>
        <p className="text-ink-muted mt-2 text-[13.5px]">
          Switching tabs or apps, pressing the Windows key or clicking outside the exam is not allowed.{' '}
          {last ? (
            <strong className="text-danger">This was your last warning. The next time, your exam will be locked.</strong>
          ) : (
            <>
              You have {warning.allowed - warning.number} warning{warning.allowed - warning.number === 1 ? '' : 's'} left; after that, your exam
              is locked until the administrator releases it.
            </>
          )}
        </p>
        <Button className="mt-5" onClick={onClose}>
          I understand
        </Button>
      </div>
    </div>
  )
}

/** A message from the exam supervisor, shown over the exam until the candidate acknowledges it. */
export function ProctorMessageDialog({ message, onAcknowledge }: { message: ProctorMessage; onAcknowledge(): void }) {
  const sent = new Date(message.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="bg-ink/60 fixed inset-0 z-[55] flex items-center justify-center p-6" role="alertdialog" aria-labelledby="proctor-message" data-testid="proctor-message">
      <div className="bg-card w-full max-w-md rounded-lg px-6 py-6 text-center shadow-xl">
        <AlertIcon className="text-warn mx-auto text-[28px]" />
        <h2 id="proctor-message" className="text-ink mt-2 text-[16px] font-semibold">
          Message from the exam supervisor
        </h2>
        <p className="text-ink mt-3 text-[14.5px] leading-relaxed whitespace-pre-wrap">{message.body}</p>
        <p className="text-ink-subtle mt-3 text-[12px]">Sent at {sent}</p>
        <Button className="mt-5" onClick={onAcknowledge}>
          I understand
        </Button>
      </div>
    </div>
  )
}

/** The exam is on hold: nothing can be answered until an administrator releases it. */
export function HoldOverlay({ control }: { control: AttemptControl }) {
  const byRule = control.hold_reason === 'TAB_SWITCH_LIMIT'
  return (
    <div className="bg-ink/80 fixed inset-0 z-[60] flex items-center justify-center p-6" role="alertdialog" aria-labelledby="exam-on-hold" data-testid="exam-on-hold">
      <div className="bg-card w-full max-w-md rounded-lg px-6 py-7 text-center shadow-xl">
        <LockIcon className="text-danger mx-auto text-[30px]" />
        <h2 id="exam-on-hold" className="text-ink mt-2 text-[17px] font-semibold">
          Your exam is locked
        </h2>
        <p className="text-ink-muted mt-2 text-[13.5px]">
          {byRule
            ? `You left the exam window ${control.tab_switches} times. The exam is locked until the administrator reviews it.`
            : 'The exam supervisor has locked your exam.'}
        </p>
        <p className="text-ink-muted mt-2 text-[13px]">
          Your answers are saved. Please stay here and wait for the administrator. The exam clock keeps running.
        </p>
        <p className="text-ink-subtle mt-4 text-[12px]" role="status">
          Waiting for the administrator…
        </p>
      </div>
    </div>
  )
}
