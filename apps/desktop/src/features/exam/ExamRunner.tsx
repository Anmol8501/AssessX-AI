import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons'
import { Logo } from '@/components/Logo'
import { Button, Card, ConfirmDialog, ErrorState } from '@/components/ui'
import { ExamTimer } from '@/features/exam/ExamTimer'
import { QuestionNavigator } from '@/features/exam/QuestionNavigator'
import { QuestionView } from '@/features/exam/QuestionView'
import { useAnswers, useSubmitExam } from '@/features/exam/useExam'
import { useExamClock } from '@/features/exam/useExamClock'
import type { AnswerState, AttemptDetail } from '@/features/exam/types'

/**
 * The exam paper: questions, answers, the countdown and submission (Phase 3).
 *
 * Used for every attempt, proctored or not. A proctored exam passes its device status in through
 * `headerExtra`; nothing about answering, timing or submitting changes with proctoring.
 */
interface ExamRunnerProps {
  attempt: AttemptDetail
  /** Shown in the header beside the timer — the proctoring status, for a proctored exam. */
  headerExtra?: ReactNode
  /** Called with the finalized attempt when submission succeeds. */
  onFinished: (attempt: AttemptDetail) => void
  /** Called when the server says the attempt ended while the candidate was still working. */
  onStale: () => void
}

export function ExamRunner({ attempt, headerExtra, onFinished, onStale }: ExamRunnerProps) {
  const [index, setIndex] = useState(0)
  const [confirmingSubmit, setConfirmingSubmit] = useState(false)

  const clock = useExamClock(attempt)
  const { submit, busy: submitting, error: submitError } = useSubmitExam()
  // A save refused because the exam closed is not a save failure — reload and show the outcome.
  const handleLocked = useCallback(() => onStale(), [onStale])
  const { answers, saveStates, setSelection, retry } = useAnswers(
    attempt.id,
    attempt.answers,
    handleLocked,
  )

  const questions = attempt.questions
  const question = questions[index]
  // Phase 2B's setting, honoured here: SEQUENTIAL means forward-only, FREE means any order.
  const canJump = attempt.question_navigation === 'FREE'
  const answeredCount = questions.filter((q) => (answers[q.id]?.length ?? 0) > 0).length

  // The server ended the attempt while this screen was open — re-read it and show the outcome
  // rather than letting the candidate carry on answering a closed exam.
  useEffect(() => {
    if (clock.finished) onStale()
  }, [clock.finished, onStale])

  if (!question) {
    return (
      <Centred>
        <ErrorState
          title="This exam has no questions"
          description="Contact your administrator — the exam was published without any questions."
        />
      </Centred>
    )
  }

  async function handleSubmit() {
    const finalized = await submit(attempt.id)
    setConfirmingSubmit(false)
    // A null result means the server finished the attempt first; reloading shows which way.
    if (finalized) onFinished(finalized)
    else onStale()
  }

  const answer: AnswerState = answers[question.id] ?? []
  const saveState = saveStates[question.id] ?? 'idle'

  return (
    <div className="bg-surface flex h-full w-full flex-col">
      <header className="border-line bg-card flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo size="sm" />
          <span className="bg-line h-5 w-px shrink-0" aria-hidden />
          <h1 className="text-ink truncate text-[14px] font-semibold">{attempt.title}</h1>
        </div>
        <div className="text-ink-subtle flex shrink-0 items-center gap-4 text-[12.5px]">
          {headerExtra}
          <span className="tabular-nums">
            Question {index + 1} of {questions.length}
          </span>
          <ExamTimer clock={clock} />
          {/* No way out but finishing: once an exam starts it runs to submission or to the
              deadline. */}
          <Button size="sm" onClick={() => setConfirmingSubmit(true)}>
            Submit Exam
          </Button>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 gap-6 px-8 py-7">
        <main className="flex min-w-0 flex-1 flex-col">
          <Card className="flex min-h-0 flex-1 flex-col px-7 py-6">
            <QuestionView
              question={question}
              index={index}
              total={questions.length}
              answer={answer}
              saveState={saveState}
              onSelect={(selected) => setSelection(question.id, selected)}
              onRetry={() => retry(question.id)}
            />
          </Card>

          {submitError && (
            <p className="text-danger mt-3 text-[13px]" role="alert">
              {submitError}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="secondary"
              onClick={() => setIndex((i) => i - 1)}
              disabled={index === 0 || !canJump}
              leadingIcon={<ArrowLeftIcon />}
            >
              Previous
            </Button>
            <Button
              onClick={() => setIndex((i) => i + 1)}
              disabled={index === questions.length - 1}
              trailingIcon={<ArrowRightIcon />}
            >
              Next
            </Button>
          </div>
        </main>

        <aside className="w-60 shrink-0">
          <Card className="px-5 py-5">
            <QuestionNavigator
              questions={questions}
              answers={answers}
              currentIndex={index}
              canJump={canJump}
              onJump={setIndex}
            />
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmingSubmit}
        title="Submit Exam?"
        description={`You have answered ${answeredCount} of ${questions.length} question${
          questions.length === 1 ? '' : 's'
        }. Once submitted, you cannot change your answers.`}
        confirmLabel="Submit Exam"
        cancelLabel="Continue Exam"
        busy={submitting}
        onConfirm={() => void handleSubmit()}
        onCancel={() => setConfirmingSubmit(false)}
      />

    </div>
  )
}

/** A single card in the middle of the exam window, for loading, error and gate states. */
export function Centred({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface flex h-full w-full items-center justify-center p-8">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  )
}
