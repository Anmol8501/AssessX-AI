import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons'
import { Logo } from '@/components/Logo'
import { Button, Card, ConfirmDialog, ErrorState, LoadingState } from '@/components/ui'
import { ExamFinished } from '@/features/exam/ExamFinished'
import { ExamTimer } from '@/features/exam/ExamTimer'
import { QuestionNavigator } from '@/features/exam/QuestionNavigator'
import { QuestionView } from '@/features/exam/QuestionView'
import { useAnswers, useAttempt, useExamDetail, useSubmitExam } from '@/features/exam/useExam'
import { useExamClock } from '@/features/exam/useExamClock'
import type { AnswerState, AttemptDetail } from '@/features/exam/types'
import { TERMINAL_ATTEMPT_STATUSES } from '@/features/exam/types'

/**
 * The exam itself, outside the application shell: no sidebar, no navigation, nothing to read but
 * the question. This is the screen a candidate spends the whole exam on.
 *
 * The attempt is resolved from the assessment rather than passed in the URL, so reopening the app
 * on this route resumes the same attempt instead of starting another — and resolves to the
 * finished screen once it is over, rather than reopening a closed exam.
 */
export function ExamAttemptPage() {
  const { assessmentId = '' } = useParams()
  const navigate = useNavigate()
  const { state: examState } = useExamDetail(assessmentId)
  // The latest attempt, not only an active one: after submitting or running out of time there is
  // nothing to resume, but there is still something to show.
  const attemptId = examState.status === 'ready' ? examState.data.latest_attempt_id : null
  const { state: attemptState, reload, replace } = useAttempt(attemptId)

  if (examState.status === 'loading') {
    return (
      <Centred>
        <LoadingState title="Opening your exam…" layout="page" />
      </Centred>
    )
  }

  if (examState.status === 'error') {
    return (
      <Centred>
        <ErrorState title="Could not open this exam" description={examState.message} />
      </Centred>
    )
  }

  if (!attemptId) {
    return (
      <Centred>
        <ErrorState
          title="This exam has not been started"
          description="Open the exam details to begin."
          onRetry={() => navigate(routes.candidate.examDetail(assessmentId))}
        />
      </Centred>
    )
  }

  if (attemptState.status !== 'ready') {
    return (
      <Centred>
        {attemptState.status === 'error' ? (
          <ErrorState title="Could not load your exam" description={attemptState.message} />
        ) : (
          <LoadingState title="Opening your exam…" layout="page" />
        )}
      </Centred>
    )
  }

  if (TERMINAL_ATTEMPT_STATUSES.has(attemptState.data.status)) {
    return <ExamFinished attempt={attemptState.data} />
  }

  return <ExamRunner attempt={attemptState.data} onFinished={replace} onStale={() => void reload()} />
}

interface ExamRunnerProps {
  attempt: AttemptDetail
  /** Called with the finalized attempt when submission succeeds. */
  onFinished: (attempt: AttemptDetail) => void
  /** Called when the server says the attempt ended while the candidate was still working. */
  onStale: () => void
}

function ExamRunner({ attempt, onFinished, onStale }: ExamRunnerProps) {
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

function Centred({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface flex h-full w-full items-center justify-center p-8">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  )
}
