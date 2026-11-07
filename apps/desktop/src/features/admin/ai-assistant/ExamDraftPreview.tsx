import { useState } from 'react'
import { CheckIcon } from '@/components/icons'
import { Button, StatusBadge } from '@/components/ui'
import type { PendingExamPayload } from './types'

interface ExamDraftPreviewProps {
  payload: PendingExamPayload
  confirming: boolean
  onConfirm: () => void
}

export function ExamDraftPreview({ payload, confirming, onConfirm }: ExamDraftPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const { assessment, questions } = payload

  return (
    <div className="rounded-xl border border-accent/30 bg-accent-muted/10 p-4 text-[13px] shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-ink text-[14.5px]">{assessment.title}</span>
            <StatusBadge tone="accent">{assessment.assessment_type}</StatusBadge>
          </div>
          {assessment.description && (
            <p className="mt-1 text-ink-subtle text-[12.5px] line-clamp-2">{assessment.description}</p>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-card/60 p-2.5 text-center border border-line">
        <div>
          <span className="block text-[11px] text-ink-subtle uppercase tracking-wider">Duration</span>
          <span className="font-semibold text-ink">{assessment.duration_minutes} min</span>
        </div>
        <div>
          <span className="block text-[11px] text-ink-subtle uppercase tracking-wider">Total Marks</span>
          <span className="font-semibold text-ink">{assessment.total_marks}</span>
        </div>
        <div>
          <span className="block text-[11px] text-ink-subtle uppercase tracking-wider">Passing</span>
          <span className="font-semibold text-ink">{assessment.passing_marks}</span>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[12.5px] text-ink-subtle">
          <span>{questions.length} questions generated</span>
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-accent hover:underline font-medium text-[12px]"
          >
            {expanded ? 'Hide questions' : 'Review all questions'}
          </button>
        </div>

        {expanded && (
          <div className="mt-2.5 max-h-60 overflow-y-auto space-y-2 pr-1 divide-y divide-line">
            {questions.map((q, idx) => (
              <div key={idx} className="pt-2 first:pt-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-ink text-[12.5px]">
                    {idx + 1}. {q.text}
                  </p>
                  <span className="shrink-0 text-[11px] font-mono text-ink-subtle bg-card px-1.5 py-0.5 rounded border border-line">
                    {q.marks} {q.marks === 1 ? 'mark' : 'marks'}
                  </span>
                </div>
                <ul className="mt-1.5 space-y-1 pl-3 text-[12px]">
                  {q.options.map((opt, optIdx) => (
                    <li
                      key={optIdx}
                      className={`flex items-center gap-1.5 ${
                        opt.is_correct ? 'text-ok font-medium' : 'text-ink-subtle'
                      }`}
                    >
                      {opt.is_correct && <CheckIcon className="w-3.5 h-3.5 text-ok shrink-0" />}
                      <span>{opt.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-line/60 pt-3">
        <Button
          variant="primary"
          size="sm"
          loading={confirming}
          onClick={onConfirm}
        >
          Confirm & Create Draft Exam
        </Button>
      </div>
    </div>
  )
}

