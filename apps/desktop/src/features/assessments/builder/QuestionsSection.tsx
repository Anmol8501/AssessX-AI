import { useState } from 'react'
import { AlertIcon, ArrowLeftIcon, ArrowRightIcon, CheckIcon, EyeIcon } from '@/components/icons'
import { Button, Card, CardHeader, ConfirmDialog, EmptyState } from '@/components/ui'
import { cn } from '@/lib/cn'
import { QuestionForm } from '../QuestionForm'
import { QUESTION_TYPE_LABEL, type AssessmentDetail, type Question, type QuestionInput } from '../types'
import { LockedNotice } from './LockedNotice'
import { QuestionPreview } from './QuestionPreview'

type Editor = { mode: 'closed' } | { mode: 'add' } | { mode: 'edit'; question: Question }

interface QuestionsSectionProps {
  assessment: AssessmentDetail
  /** Published assessments are locked: questions can be viewed and previewed only. */
  locked?: boolean
  saving: boolean
  error: string | null
  busyQuestionId: string | null
  onCreate(input: QuestionInput): Promise<boolean>
  onUpdate(questionId: string, input: QuestionInput): Promise<boolean>
  onDelete(questionId: string): Promise<void>
  onDuplicate(questionId: string): Promise<void>
  onReorder(questionIds: string[]): Promise<void>
  onDismissError(): void
}

export function QuestionsSection({
  assessment,
  locked = false,
  saving,
  error,
  busyQuestionId,
  onCreate,
  onUpdate,
  onDelete,
  onDuplicate,
  onReorder,
  onDismissError,
}: QuestionsSectionProps) {
  const [editor, setEditor] = useState<Editor>({ mode: 'closed' })
  const [previewing, setPreviewing] = useState<Question | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Question | null>(null)
  const [deleting, setDeleting] = useState(false)

  const questions = assessment.questions
  const idle = editor.mode === 'closed' && !saving && busyQuestionId === null && !locked

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= questions.length) return
    const ids = questions.map((question) => question.id)
    ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
    void onReorder(ids)
  }

  async function submit(input: QuestionInput) {
    const ok = editor.mode === 'edit' ? await onUpdate(editor.question.id, input) : await onCreate(input)
    if (ok) setEditor({ mode: 'closed' })
  }

  function closeEditor() {
    setEditor({ mode: 'closed' })
    onDismissError()
  }

  return (
    <>
      {locked && (
        <div className="mb-4">
          <LockedNotice />
        </div>
      )}

      <Card>
        <CardHeader
          title="Questions"
          description={`${assessment.question_count} question(s) · ${assessment.allocated_marks} of ${assessment.total_marks} marks allocated`}
          actions={
            editor.mode === 'closed' && !locked ? (
              <Button size="sm" onClick={() => setEditor({ mode: 'add' })}>
                + Add Question
              </Button>
            ) : undefined
          }
        />

        {error && editor.mode === 'closed' && (
          <div className="border-danger/30 bg-danger-soft text-danger mx-5 mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
            <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
            {error}
          </div>
        )}

        {questions.length === 0 && editor.mode === 'closed' ? (
          <EmptyState
            title="No questions yet"
            description="Add the first question to this assessment."
            action={locked ? undefined : <Button onClick={() => setEditor({ mode: 'add' })}>+ Add Question</Button>}
          />
        ) : (
          <ul className="divide-line divide-y">
            {questions.map((question, index) =>
              editor.mode === 'edit' && editor.question.id === question.id ? (
                <li key={question.id} className="bg-surface px-5 py-4">
                  <QuestionForm question={question} submitting={saving} error={error} onSubmit={submit} onCancel={closeEditor} />
                </li>
              ) : (
                <li key={question.id} className={cn('px-5 py-4', busyQuestionId === question.id && 'opacity-60')}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                      {/* Reorder controls: explicit, keyboard-accessible, persisted server-side. */}
                      <div className="flex flex-col gap-1 pt-0.5">
                        <button
                          type="button"
                          onClick={() => move(index, -1)}
                          disabled={!idle || index === 0}
                          aria-label={`Move question ${index + 1} up`}
                          className="border-line text-ink-subtle hover:border-ink-subtle hover:text-ink flex h-6 w-6 items-center justify-center rounded border transition-colors disabled:opacity-40"
                        >
                          <ArrowRightIcon className="-rotate-90 text-[13px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(index, 1)}
                          disabled={!idle || index === questions.length - 1}
                          aria-label={`Move question ${index + 1} down`}
                          className="border-line text-ink-subtle hover:border-ink-subtle hover:text-ink flex h-6 w-6 items-center justify-center rounded border transition-colors disabled:opacity-40"
                        >
                          <ArrowLeftIcon className="-rotate-90 text-[13px]" />
                        </button>
                      </div>

                      <div className="min-w-0">
                        <p className="text-ink text-[14px] font-medium">
                          <span className="text-ink-subtle mr-2 font-mono text-[12.5px]">{index + 1}.</span>
                          {question.text}
                        </p>
                        <p className="text-ink-subtle mt-1 text-[12.5px]">
                          {QUESTION_TYPE_LABEL[question.type]} · {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
                        </p>
                        <ul className="mt-2.5 space-y-1">
                          {question.options.map((option) => (
                            <li
                              key={option.id}
                              className={cn('flex items-center gap-2 text-[13px]', option.is_correct ? 'text-ok font-medium' : 'text-ink-muted')}
                            >
                              <span
                                className={cn(
                                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[11px]',
                                  option.is_correct ? 'border-ok bg-ok text-white' : 'border-line-strong text-transparent',
                                )}
                              >
                                <CheckIcon />
                              </span>
                              {option.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" disabled={!idle} leadingIcon={<EyeIcon className="text-[15px]" />} onClick={() => setPreviewing(question)}>
                        Preview
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!idle} onClick={() => { onDismissError(); setEditor({ mode: 'edit', question }) }}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!idle} onClick={() => void onDuplicate(question.id)}>
                        Duplicate
                      </Button>
                      <Button variant="ghost" size="sm" disabled={!idle} onClick={() => setPendingDelete(question)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}

        {editor.mode === 'add' && (
          <div className="border-line bg-surface border-t px-5 py-4">
            <QuestionForm submitting={saving} error={error} onSubmit={submit} onCancel={closeEditor} />
          </div>
        )}
      </Card>

      <QuestionPreview
        question={previewing}
        number={previewing ? questions.findIndex((q) => q.id === previewing.id) + 1 : 0}
        onClose={() => setPreviewing(null)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete question?"
        description="This permanently removes the question and its options from the assessment."
        confirmLabel="Delete"
        confirmVariant="danger"
        busy={deleting}
        onConfirm={async () => {
          if (!pendingDelete) return
          setDeleting(true)
          try {
            await onDelete(pendingDelete.id)
            setPendingDelete(null)
          } finally {
            setDeleting(false)
          }
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  )
}
