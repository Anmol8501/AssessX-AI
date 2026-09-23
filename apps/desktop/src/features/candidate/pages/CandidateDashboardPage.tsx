import { Link } from 'react-router'
import { routes } from '@/app/routes'
import { ClockIcon } from '@/components/icons'
import { Card, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import type { MyAssessment } from '@/features/assessments/types'
import { useCurrentUser } from '@/features/session'
import { useMyAssessments } from '../useMyAssessments'

/** The few assigned exams worth showing on the dashboard; the rest live on My Exams. */
const PREVIEW_COUNT = 5

/** Exams with a scheduled start come first, soonest first; undated ones follow, newest assignment first. */
function byWhenItOpens(a: MyAssessment, b: MyAssessment): number {
  if (a.availability_start && b.availability_start) {
    return new Date(a.availability_start).getTime() - new Date(b.availability_start).getTime()
  }
  if (a.availability_start) return -1
  if (b.availability_start) return 1
  return new Date(b.assigned_at).getTime() - new Date(a.assigned_at).getTime()
}

function formatWhen(exam: MyAssessment): string {
  if (!exam.availability_start) return 'No scheduled window'
  const date = new Date(exam.availability_start)
  return Number.isNaN(date.getTime()) ? 'No scheduled window' : `Opens ${date.toLocaleString()}`
}

export function CandidateDashboardPage() {
  const user = useCurrentUser()
  const { state, reload } = useMyAssessments()

  return (
    <>
      <PageHeader title={`Welcome, ${user.name}`} description="Your upcoming and completed assessments." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Upcoming assessments"
            description={state.status === 'ready' ? `${state.data.length} assigned to you.` : undefined}
            actions={
              state.status === 'ready' && state.data.length > 0 ? (
                <Link to={routes.candidate.exams} className="text-accent text-[13px] font-medium hover:underline">
                  View all
                </Link>
              ) : undefined
            }
          />

          {state.status === 'loading' && <LoadingState title="Loading your exams…" />}
          {state.status === 'error' && (
            <ErrorState title="Could not load your exams" description={state.message} onRetry={() => void reload()} />
          )}
          {state.status === 'ready' &&
            (state.data.length === 0 ? (
              <EmptyState
                title="No exams yet"
                description="Assessments assigned to you by your organisation will appear here."
              />
            ) : (
              <ul className="divide-line divide-y">
                {[...state.data].sort(byWhenItOpens).slice(0, PREVIEW_COUNT).map((exam) => (
                  <li key={exam.assignment_id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                    <div className="min-w-0">
                      <Link
                        to={routes.candidate.exams}
                        className="text-ink hover:text-accent block truncate text-[14px] font-medium"
                      >
                        {exam.title}
                      </Link>
                      <p className="text-ink-subtle mt-1 flex items-center gap-1.5 text-[12.5px]">
                        <ClockIcon className="text-[14px]" />
                        {formatWhen(exam)}
                        <span aria-hidden>·</span>
                        {exam.duration_minutes} min
                        <span aria-hidden>·</span>
                        {exam.question_count} {exam.question_count === 1 ? 'question' : 'questions'}
                      </p>
                    </div>
                    <StatusBadge tone="accent">Assigned</StatusBadge>
                  </li>
                ))}
              </ul>
            ))}
        </Card>

        <Card>
          <CardHeader title="Completed" />
          {/* Nothing is recorded as completed or skipped until exams can actually be taken (Phase 3),
              so this stays empty rather than showing a status the backend cannot yet know. */}
          <EmptyState
            title="Nothing completed yet"
            description="Submitted and skipped assessments will be listed here once exams can be taken."
          />
        </Card>
      </div>
    </>
  )
}
