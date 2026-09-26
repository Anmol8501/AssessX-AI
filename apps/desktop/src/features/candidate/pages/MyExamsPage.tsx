import { routes } from '@/app/routes'
import { ClockIcon } from '@/components/icons'
import {
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@/components/ui'
import type { MyAssessment } from '@/features/assessments/types'
import { AttemptBadge } from '@/features/exam/AttemptBadge'
import { formatWindow } from '@/features/exam/format'
import { useMyAssessments } from '../useMyAssessments'

/**
 * The candidate's assigned exams, and the way into each one.
 *
 * Whether a card offers Start or Resume comes from `active_attempt_id` on the server's own
 * response, so a card cannot promise a fresh start when an attempt is already under way.
 */
export function MyExamsPage() {
  const { state, reload } = useMyAssessments()

  return (
    <>
      <PageHeader title="My Exams" description="Assessments assigned to you, with instructions and start windows." />

      {state.status === 'loading' && (
        <Card>
          <LoadingState title="Loading your exams…" />
        </Card>
      )}

      {state.status === 'error' && (
        <Card>
          <ErrorState title="Could not load your exams" description={state.message} onRetry={() => void reload()} />
        </Card>
      )}

      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <Card>
            <EmptyState
              title="No exams assigned yet"
              description="When an administrator assigns you an exam, it will appear here."
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {state.data.map((exam) => (
              <ExamCard key={exam.assignment_id} exam={exam} />
            ))}
          </div>
        ))}
    </>
  )
}

function ExamCard({ exam }: { exam: MyAssessment }) {
  const inProgress = exam.active_attempt_id !== null
  const finished = exam.latest_attempt_status === 'SUBMITTED' || exam.latest_attempt_status === 'TIME_EXPIRED'

  return (
    <Card>
      <CardHeader
        title={exam.title}
        description={exam.description ?? undefined}
        actions={<AttemptBadge resuming={inProgress} status={exam.latest_attempt_status} />}
      />
      <CardBody className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Detail label="Questions" value={`${exam.question_count}`} />
          <Detail label="Duration" value={`${exam.duration_minutes} min`} />
          <Detail label="Total marks" value={`${exam.total_marks}`} />
          <Detail label="Passing marks" value={`${exam.passing_marks}`} />
        </dl>

        <p className="text-ink-subtle flex items-start gap-2 text-[12.5px]">
          <ClockIcon className="mt-0.5 shrink-0 text-[14px]" />
          {formatWindow(exam.availability_start, exam.availability_end)}
          <span aria-hidden> · </span>
          {exam.max_attempts} {exam.max_attempts === 1 ? 'attempt' : 'attempts'} allowed
          {exam.proctoring_required && (
            <>
              <span aria-hidden> · </span>
              Proctored — camera and microphone required
            </>
          )}
        </p>

        <div className="flex items-center justify-end gap-3">
          <ButtonLink
            to={routes.candidate.examDetail(exam.assessment_id)}
            variant={inProgress || finished ? 'secondary' : 'primary'}
          >
            View Details
          </ButtonLink>
          {inProgress && <ButtonLink to={routes.candidate.attempt(exam.assessment_id)}>Resume Exam</ButtonLink>}
          {/* A finished exam cannot be restarted, so the way in is the result, not the paper. */}
          {finished && <ButtonLink to={routes.candidate.attempt(exam.assessment_id)}>View Result</ButtonLink>}
        </div>
      </CardBody>
    </Card>
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
