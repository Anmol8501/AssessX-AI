import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { ArrowLeftIcon, ClockIcon, InfoIcon, LockIcon } from '@/components/icons'
import {
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@/components/ui'
import { AttemptBadge } from '@/features/exam/AttemptBadge'
import { formatWindow } from '@/features/exam/format'
import { useExamDetail, useStartExam } from '@/features/exam/useExam'

/**
 * What the exam is, what the rules are, and the way in.
 *
 * Whether the exam can be started is the server's answer (`can_start` / `start_blocked_reason`),
 * not this screen's guess, so the button can never offer something the backend would refuse.
 */
export function ExamDetailsPage() {
  const { assessmentId = '' } = useParams()
  const navigate = useNavigate()
  const { state, reload } = useExamDetail(assessmentId)
  const { start, busy, error } = useStartExam()

  async function beginExam() {
    const attempt = await start(assessmentId)
    if (attempt) navigate(routes.candidate.attempt(assessmentId))
  }

  if (state.status === 'loading') {
    return (
      <Card>
        <LoadingState title="Loading exam…" />
      </Card>
    )
  }

  if (state.status === 'error') {
    return (
      <Card>
        <ErrorState title="Could not load this exam" description={state.message} onRetry={() => void reload()} />
      </Card>
    )
  }

  const exam = state.data
  const resuming = exam.active_attempt_id !== null
  const finished = exam.latest_attempt_status === 'SUBMITTED' || exam.latest_attempt_status === 'TIME_EXPIRED'

  return (
    <>
      <PageHeader
        title={exam.title}
        description={exam.description ?? undefined}
        actions={
          <Button variant="ghost" onClick={() => navigate(routes.candidate.exams)} leadingIcon={<ArrowLeftIcon />}>
            My Exams
          </Button>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Exam details"
            actions={<AttemptBadge resuming={resuming} status={exam.latest_attempt_status} />}
          />
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Detail label="Questions" value={`${exam.question_count}`} />
              <Detail label="Duration" value={`${exam.duration_minutes} min`} />
              <Detail label="Total marks" value={`${exam.total_marks}`} />
              <Detail label="Passing marks" value={`${exam.passing_marks}`} />
              <Detail label="Attempts" value={`${exam.attempts_used} of ${exam.max_attempts} used`} />
              <Detail label="Availability" value={formatWindow(exam.availability_start, exam.availability_end)} />
            </dl>

            <p className="text-ink-subtle flex items-start gap-2 text-[12.5px]">
              <ClockIcon className="mt-0.5 shrink-0 text-[14px]" />
              The clock starts when you begin and keeps running until the duration is up, even if you
              close the application. The exam ends itself when the time runs out.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Instructions" description="Read these before you begin." />
          <CardBody className="space-y-3">
            {exam.instructions ? (
              <p className="text-ink text-[14px] leading-relaxed whitespace-pre-line">{exam.instructions}</p>
            ) : (
              <p className="text-ink-subtle text-[13.5px]">
                Your administrator did not add instructions for this exam.
              </p>
            )}

            {/* Describes only what this build actually does. No proctoring claims: none is implemented. */}
            <ul className="text-ink-muted list-disc space-y-1 pl-5 text-[13.5px]">
              <li>Read each question carefully and select your answer.</li>
              <li>
                {exam.question_count > 0
                  ? `There ${exam.question_count === 1 ? 'is 1 question' : `are ${exam.question_count} questions`}. `
                  : ''}
                You can move between questions and change your answers.
              </li>
              <li>Each answer is saved as you make it, and the screen tells you when it has been saved.</li>
              <li>You can mark a question for review and come back to it.</li>
              <li>
                If you close the application, reopening this exam returns you to the same attempt —
                with the same remaining time, not a fresh clock.
              </li>
              <li>Submit when you are finished. After that, and after the time runs out, answers are final.</li>
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              {finished ? (
                <p className="text-ink-muted flex items-start gap-2 text-[13px]">
                  <InfoIcon className="mt-0.5 shrink-0 text-[15px]" />
                  {exam.latest_attempt_status === 'SUBMITTED'
                    ? 'You have submitted this exam. Your answers are final.'
                    : 'Time ran out for this exam. Your saved answers are final.'}{' '}
                  Open the result to see how it was marked.
                </p>
              ) : resuming ? (
                <p className="text-ink-muted flex items-start gap-2 text-[13px]">
                  <InfoIcon className="mt-0.5 shrink-0 text-[15px]" />
                  You have an attempt in progress. Continuing returns you to it with your saved answers.
                </p>
              ) : exam.can_start ? (
                <p className="text-ink-muted flex items-start gap-2 text-[13px]">
                  <InfoIcon className="mt-0.5 shrink-0 text-[15px]" />
                  Starting begins the clock. It runs for the full duration whether or not the application stays open.
                </p>
              ) : (
                <p className="text-danger flex items-start gap-2 text-[13px]" role="status">
                  <LockIcon className="mt-0.5 shrink-0 text-[15px]" />
                  {exam.start_blocked_reason ?? 'This exam cannot be started right now.'}
                </p>
              )}
              {error && (
                <p className="text-danger mt-2 text-[13px]" role="alert">
                  {error}
                </p>
              )}
            </div>

            {finished ? (
              <ButtonLink to={routes.candidate.attempt(exam.assessment_id)} variant="secondary">
                View Result
              </ButtonLink>
            ) : (
              <Button onClick={() => void beginExam()} loading={busy} disabled={!resuming && !exam.can_start}>
                {resuming ? 'Resume Exam' : 'Start Exam'}
              </Button>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-subtle text-[12px]">{label}</dt>
      <dd className="text-ink mt-0.5 text-[14px] font-medium">{value}</dd>
    </div>
  )
}
