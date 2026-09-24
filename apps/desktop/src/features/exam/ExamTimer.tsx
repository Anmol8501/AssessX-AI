import { AlertIcon, ClockIcon } from '@/components/icons'
import { cn } from '@/lib/cn'
import { CRITICAL_SECONDS, WARNING_SECONDS, formatRemaining, type ExamClock } from './useExamClock'

/**
 * The countdown.
 *
 * Urgency is shown by colour *and* by the accessible label, so it does not rely on noticing a
 * shade change. It is deliberately plain: a candidate running out of time does not need alarm
 * styling on top of the fact.
 *
 * The number is a display of the server's deadline, never an input to it — see `useExamClock`.
 */
export function ExamTimer({ clock }: { clock: ExamClock }) {
  const { remaining, online, finished } = clock
  const critical = !finished && remaining <= CRITICAL_SECONDS
  const warning = !finished && !critical && remaining <= WARNING_SECONDS

  return (
    <div className="flex items-center gap-2">
      {!online && (
        <span
          className="text-warn inline-flex items-center gap-1 text-[12px]"
          role="status"
          title="The application cannot reach the AssessX server. Your answers are not being saved."
        >
          <AlertIcon className="text-[14px]" />
          Offline
        </span>
      )}
      <div
        // `off`, not `polite`: announcing every second would make the screen reader unusable.
        // The thresholds below are announced instead.
        role="timer"
        aria-live="off"
        aria-label={`Time remaining: ${formatRemaining(remaining)}`}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[14px] font-semibold tabular-nums',
          critical
            ? 'border-danger/40 bg-danger-soft text-danger'
            : warning
              ? 'border-warn/40 bg-warn-soft text-warn'
              : 'border-line-strong bg-surface text-ink',
        )}
      >
        <ClockIcon className="text-[15px]" />
        {formatRemaining(remaining)}
      </div>

      {/* Announced once when each threshold is crossed, rather than on every tick. */}
      <span className="sr-only" role="status" aria-live="polite">
        {critical
          ? 'Less than one minute remaining.'
          : warning
            ? 'Less than five minutes remaining.'
            : ''}
      </span>
    </div>
  )
}
