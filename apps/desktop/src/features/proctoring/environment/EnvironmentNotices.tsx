import { InfoIcon } from '@/components/icons'
import { Button } from '@/components/ui'
import type { Notice } from './useEnvironmentEnforcement'

interface EnvironmentNoticesProps {
  notices: Notice[]
  fullscreenRequired: boolean
  onReturnToFullscreen(): void
}

/**
 * What the candidate sees when the exam environment restricts something (Phase 4B).
 *
 * Short, factual notices — "Pasting is disabled during this assessment." — that fade on their own
 * and never accuse. Leaving fullscreen is the one thing that interrupts the exam: the paper is
 * covered until the candidate returns, while the clock keeps running as always.
 */
export function EnvironmentNotices({ notices, fullscreenRequired, onReturnToFullscreen }: EnvironmentNoticesProps) {
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-16 z-40 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {notices.map((notice) => (
          <div
            key={notice.id}
            role="status"
            className="border-line bg-card text-ink flex max-w-md items-start gap-2 rounded-md border px-4 py-2.5 text-[13px] shadow-md"
          >
            <InfoIcon className="text-accent mt-0.5 shrink-0 text-[15px]" />
            {notice.message}
          </div>
        ))}
      </div>

      {fullscreenRequired && (
        <div className="bg-ink/60 fixed inset-0 z-50 flex items-center justify-center p-6" role="alertdialog" aria-labelledby="fullscreen-required">
          <div className="bg-card w-full max-w-sm rounded-lg px-6 py-6 text-center shadow-xl">
            <h2 id="fullscreen-required" className="text-ink text-[16px] font-semibold">
              Please return to fullscreen to continue your assessment.
            </h2>
            <p className="text-ink-muted mt-2 text-[13px]">
              The exam runs in fullscreen. Your answers are saved and the clock is still running.
            </p>
            <Button className="mt-5" onClick={onReturnToFullscreen}>
              Return to fullscreen
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
