import { cn } from '@/lib/cn'
import type { AnswerState, CandidateQuestion } from './types'

interface QuestionNavigatorProps {
  questions: CandidateQuestion[]
  answers: Record<string, AnswerState>
  currentIndex: number
  /** `false` under SEQUENTIAL navigation: the panel still shows progress, but cannot jump. */
  canJump: boolean
  onJump: (index: number) => void
}

/**
 * The question panel: where the candidate is, and which questions they have answered.
 *
 * Status is carried by each button's accessible name as well as by colour, so it does not depend
 * on distinguishing two shades.
 */
export function QuestionNavigator({
  questions,
  answers,
  currentIndex,
  canJump,
  onJump,
}: QuestionNavigatorProps) {
  const answered = questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length

  return (
    <nav aria-label="Questions" className="flex flex-col gap-4">
      <div>
        <h2 className="text-ink text-[13px] font-semibold">Questions</h2>
        <p className="text-ink-subtle mt-0.5 text-[12.5px]">
          {answered} of {questions.length} answered
        </p>
      </div>

      <ol className="grid grid-cols-5 gap-2">
        {questions.map((question, index) => {
          const isAnswered = (answers[question.id]?.length ?? 0) > 0
          const isCurrent = index === currentIndex
          const status = isAnswered ? 'answered' : 'not answered'

          return (
            <li key={question.id}>
              <button
                type="button"
                onClick={() => onJump(index)}
                disabled={!canJump && !isCurrent}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`Question ${index + 1}, ${status}`}
                title={`Question ${index + 1} — ${status}`}
                className={cn(
                  'relative flex h-9 w-full items-center justify-center rounded-md border text-[13px] font-medium tabular-nums transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  isCurrent
                    ? 'border-accent bg-accent text-white'
                    : isAnswered
                      ? 'border-ok/40 bg-ok-soft text-ok'
                      : 'border-line-strong bg-card text-ink-muted enabled:hover:border-ink-subtle enabled:hover:bg-gray-50',
                )}
              >
                {index + 1}
              </button>
            </li>
          )
        })}
      </ol>

      <dl className="text-ink-subtle space-y-1.5 text-[12px]">
        <Legend className="border-accent bg-accent" label="Current question" />
        <Legend className="border-ok/40 bg-ok-soft" label="Answered" />
        <Legend className="border-line-strong bg-card" label="Not answered" />
      </dl>

      {!canJump && (
        <p className="text-ink-subtle text-[12px]">
          This exam moves forward only. Once you leave a question you cannot return to it.
        </p>
      )}
    </nav>
  )
}

function Legend({ className, label, round }: { className: string; label: string; round?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="sr-only">{label}</dt>
      <span
        aria-hidden
        className={cn('inline-block border', round ? 'h-2.5 w-2.5 rounded-full' : 'h-3.5 w-3.5 rounded', className)}
      />
      <dd>{label}</dd>
    </div>
  )
}
