import { useEffect, useRef } from 'react'
import { CheckIcon } from '@/components/icons'
import { Button, StatusBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { QUESTION_TYPE_LABEL, SINGLE_ANSWER_TYPES, type Question } from '../types'

interface QuestionPreviewProps {
  question: Question | null
  /** 1-based position, for the heading. */
  number: number
  onClose(): void
}

/**
 * Shows a question the way a candidate will see it — with the answer key marked, because this is
 * an admin preview. It is *not* the exam interface; that arrives with Phase 3.
 */
export function QuestionPreview({ question, number, onClose }: QuestionPreviewProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (question && !dialog.open) dialog.showModal()
    if (!question && dialog.open) dialog.close()
  }, [question])

  const single = question ? SINGLE_ANSWER_TYPES.has(question.type) : true

  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose()
      }}
      className="border-line bg-card shadow-float m-auto w-full max-w-xl rounded-lg border p-0 backdrop:bg-gray-900/40"
      aria-labelledby="question-preview-title"
    >
      {question && (
        <>
          <div className="border-line flex items-start justify-between gap-4 border-b px-6 py-4">
            <div>
              <h2 id="question-preview-title" className="text-ink text-[15px] font-semibold">
                Question {number} preview
              </h2>
              <p className="text-ink-subtle mt-0.5 text-[12.5px]">
                {QUESTION_TYPE_LABEL[question.type]} · {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
              </p>
            </div>
            <StatusBadge tone="accent">Admin view — answers shown</StatusBadge>
          </div>

          <div className="px-6 py-5">
            <p className="text-ink text-[15px] leading-relaxed">{question.text}</p>
            <p className="text-ink-subtle mt-1.5 text-[12.5px]">
              {single ? 'Select one answer.' : 'Select all that apply.'}
            </p>

            <ul className="mt-4 space-y-2">
              {question.options.map((option) => (
                <li
                  key={option.id}
                  className={cn(
                    'flex items-center gap-3 rounded-md border px-3 py-2.5 text-[14px]',
                    option.is_correct ? 'border-ok bg-ok-soft text-ink' : 'border-line bg-card text-ink-muted',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center border',
                      single ? 'rounded-full' : 'rounded',
                      option.is_correct ? 'border-ok bg-ok text-white' : 'border-line-strong text-transparent',
                    )}
                  >
                    <CheckIcon className="text-[13px]" />
                  </span>
                  {option.text}
                </li>
              ))}
            </ul>

            {question.explanation && (
              <div className="border-line bg-surface mt-4 rounded-md border px-3 py-2.5">
                <p className="text-ink-subtle text-[11.5px] font-semibold tracking-[0.1em] uppercase">Explanation</p>
                <p className="text-ink-muted mt-1 text-[13px] leading-relaxed">{question.explanation}</p>
              </div>
            )}
          </div>

          <div className="border-line bg-surface flex justify-end rounded-b-lg border-t px-6 py-3.5">
            <Button variant="secondary" onClick={onClose} autoFocus>
              Close preview
            </Button>
          </div>
        </>
      )}
    </dialog>
  )
}
