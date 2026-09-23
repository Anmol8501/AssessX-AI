import { ClockIcon, InfoIcon, LockIcon } from '@/components/icons'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui'
import type { MyAssessment } from '@/features/assessments/types'
import { useMyAssessments } from '../useMyAssessments'

function formatWindow(start: string | null, end: string | null): string {
  const format = (value: string) => {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
  }
  if (start && end) return `${format(start)} — ${format(end)}`
  if (start) return `From ${format(start)}`
  if (end) return `Until ${format(end)}`
  return 'No scheduled window'
}

/**
 * The candidate's assigned exams. Starting an exam is Phase 3 — the action here is
 * deliberately disabled rather than faked.
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
  return (
    <Card>
      <CardHeader
        title={exam.title}
        description={exam.description ?? undefined}
        actions={<StatusBadge tone="accent">Assigned</StatusBadge>}
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
        </p>

        {exam.instructions && (
          <div className="border-line bg-surface rounded-md border px-3 py-2.5">
            <p className="text-ink text-[12.5px] font-semibold">Instructions</p>
            <p className="text-ink-muted mt-1 text-[13px] whitespace-pre-line">{exam.instructions}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <p className="text-ink-subtle flex items-start gap-2 text-[12.5px]">
            <InfoIcon className="mt-0.5 shrink-0 text-[14px]" />
            Taking an exam arrives in Phase 3. Nothing can be started yet.
          </p>
          <Button disabled title="Available in a later phase" leadingIcon={<LockIcon className="text-[15px]" />}>
            Start Exam
          </Button>
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
