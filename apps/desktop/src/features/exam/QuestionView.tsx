import { QUESTION_TYPE_LABEL, SINGLE_ANSWER_TYPES } from '@/features/assessments/types'
import { cn } from '@/lib/cn'
import { SaveIndicator } from './SaveIndicator'
import type { AnswerState, CandidateQuestion, SaveState } from './types'

interface QuestionViewProps {
  question: CandidateQuestion
  index: number
  total: number
  answer: AnswerState
  saveState: SaveState
  onSelect: (selected: string[]) => void
  onRetry: () => void
}

/**
 * One question and its options.
 *
 * Native radios and checkboxes rather than styled `div`s: keyboard navigation, screen-reader
 * grouping and the browser's own single-selection behaviour all come for free, and NFR-007 asks
 * for exactly that.
 */
export function QuestionView({
  question,
  index,
  total,
  answer,
  saveState,
  onSelect,
  onRetry,
}: QuestionViewProps) {
  const single = SINGLE_ANSWER_TYPES.has(question.type)

  function toggle(optionId: string) {
    if (single) {
      // Clicking the chosen option again clears it — there is no other way to unset a radio.
      onSelect(answer.includes(optionId) ? [] : [optionId])
      return
    }
    onSelect(answer.includes(optionId) ? answer.filter((id) => id !== optionId) : [...answer, optionId])
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-ink text-[15px] font-semibold">
          Question {index + 1} <span className="text-ink-subtle font-normal">of {total}</span>
        </h2>
        <p className="text-ink-subtle text-[12.5px]">
          {QUESTION_TYPE_LABEL[question.type]} · {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
        </p>
      </div>

      <p className="text-ink mt-4 text-[17px] leading-relaxed whitespace-pre-line">{question.text}</p>

      <fieldset className="mt-6 space-y-2.5">
        <legend className="sr-only">{single ? 'Select one option' : 'Select all options that apply'}</legend>
        {question.options.map((option) => {
          const checked = answer.includes(option.id)
          return (
            <label
              key={option.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition-colors',
                checked
                  ? 'border-accent bg-accent-soft'
                  : 'border-line-strong bg-card hover:border-ink-subtle hover:bg-gray-50',
              )}
            >
              <input
                type={single ? 'radio' : 'checkbox'}
                name={question.id}
                className="accent-accent mt-0.5 h-4 w-4 shrink-0"
                checked={checked}
                onChange={() => toggle(option.id)}
                // A radio does not fire change when it is already on, so clearing needs a click.
                onClick={single && checked ? () => toggle(option.id) : undefined}
              />
              <span className="text-ink text-[14.5px] leading-snug">{option.text}</span>
            </label>
          )
        })}
      </fieldset>

      {!single && <p className="text-ink-subtle mt-3 text-[12.5px]">Select every option that applies.</p>}

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        <SaveIndicator state={saveState} onRetry={onRetry} />
      </div>
    </div>
  )
}
