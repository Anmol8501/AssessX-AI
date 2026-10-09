import { CODING_STATUS_LABEL, shortLabel } from '@/features/coding/candidate/codingLogic'
import { isAnswered } from './answered'
import type { CodingStatus } from '@/features/coding/types'
import { cn } from '@/lib/cn'
import type { AnswerState, CandidateQuestion } from './types'

interface QuestionNavigatorProps {
  questions: CandidateQuestion[]
  answers: Record<string, AnswerState>
  currentIndex: number
  /** `false` under SEQUENTIAL navigation: the panel still shows progress, but cannot jump. */
  canJump: boolean
  onJump: (index: number) => void
  /** Per-question labels (Question n / Problem n / Coding n); defaults to "Question n". */
  labels?: string[]
  /** Coding questions' status, by question id. */
  codingStatus?: Record<string, CodingStatus>
  /** A single row above a coding workspace, instead of the side panel. */
  compact?: boolean
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
  labels,
  codingStatus,
  compact = false,
}: QuestionNavigatorProps) {
  const answered = questions.filter((q) => isAnswered(q, answers, codingStatus)).length

  return (
    <nav aria-label="Questions" className={compact ? 'flex min-w-0 items-center gap-5' : 'flex flex-col gap-4'}>
      <div className={compact ? 'flex shrink-0 items-baseline gap-2' : undefined}>
        <h2 className="text-ink text-[13px] font-semibold">Questions</h2>
        <p className={cn('text-ink-subtle text-[12.5px]', !compact && 'mt-0.5')}>
          {answered} of {questions.length} answered
        </p>
      </div>

      <ol className={compact ? 'flex min-w-0 gap-1.5 overflow-x-auto' : 'grid grid-cols-5 gap-2'}>
        {questions.map((question, index) => {
          const answeredHere = isAnswered(question, answers, codingStatus)
          const isCurrent = index === currentIndex
          const coding = question.type === 'CODING' ? (codingStatus?.[question.id] ?? 'NOT_STARTED') : null
          const status = coding ? CODING_STATUS_LABEL[coding].toLowerCase() : answeredHere ? 'answered' : 'not answered'
          const label = labels?.[index] ?? `Question ${index + 1}`

          return (
            <li key={question.id}>
              <button
                type="button"
                onClick={() => onJump(index)}
                disabled={!canJump && !isCurrent}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`${label}, ${status}`}
                title={`${label} — ${status}`}
                className={cn(
                  'relative flex h-9 items-center justify-center rounded-md border text-[13px] font-medium tabular-nums transition-colors',
                  compact ? 'min-w-9 px-2' : 'w-full',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  isCurrent
                    ? 'border-accent bg-accent text-white'
                    : coding === 'PASSED' || (!coding && answeredHere)
                      ? 'border-ok/40 bg-ok-soft text-ok'
                      : coding === 'NOT_PASSED' || coding === 'PENDING'
                        ? 'border-warn/50 bg-warn-soft text-warn'
                        : coding === 'IN_PROGRESS'
                          ? 'border-info/40 bg-info-soft text-info'
                          : 'border-line-strong bg-card text-ink-muted enabled:hover:border-ink-subtle enabled:hover:bg-gray-50',
                )}
              >
                {shortLabel(label)}
              </button>
            </li>
          )
        })}
      </ol>

      <dl className={cn('text-ink-subtle text-[12px]', compact ? 'flex shrink-0 items-center gap-4' : 'space-y-1.5')}>
        <Legend className="border-accent bg-accent" label="Current question" />
        <Legend className="border-ok/40 bg-ok-soft" label="Answered" />
        <Legend className="border-line-strong bg-card" label="Not answered" />
      </dl>

      {!canJump && (
        <p className={cn('text-ink-subtle text-[12px]', compact && 'min-w-0 truncate')}>
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
