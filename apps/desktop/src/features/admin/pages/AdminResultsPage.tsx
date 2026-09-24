import { Link } from 'react-router'
import { routes } from '@/app/routes'
import { Card, CardBody, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import type { AssessmentSummary } from '@/features/assessments/types'
import { useAssessmentList } from '@/features/assessments/useAssessments'

/**
 * Which assessment's results to look at.
 *
 * Only published assessments can have been attempted, so only those are listed. Scores live on
 * the next screen; this one is a way in, not a dashboard.
 */
export function AdminResultsPage() {
  const { state, reload } = useAssessmentList()

  return (
    <>
      <PageHeader title="Results" description="Scores for the assessments candidates have completed." />

      {state.status === 'loading' && (
        <Card>
          <LoadingState title="Loading assessments…" />
        </Card>
      )}

      {state.status === 'error' && (
        <Card>
          <ErrorState title="Could not load assessments" description={state.message} onRetry={() => void reload()} />
        </Card>
      )}

      {state.status === 'ready' &&
        (() => {
          const published = state.data.filter((a: AssessmentSummary) => a.status === 'PUBLISHED')
          if (published.length === 0) {
            return (
              <Card>
                <EmptyState
                  title="No published assessments"
                  description="Publish an assessment and assign candidates; their results appear here once they finish."
                />
              </Card>
            )
          }
          return (
            <div className="space-y-3">
              {published.map((assessment: AssessmentSummary) => (
                <Card key={assessment.id}>
                  <CardBody className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                      <Link
                        to={routes.admin.assessmentResults(assessment.id)}
                        className="text-accent text-[14.5px] font-semibold hover:underline"
                      >
                        {assessment.title}
                      </Link>
                      <p className="text-ink-subtle mt-0.5 text-[12.5px]">
                        {assessment.question_count} question{assessment.question_count === 1 ? '' : 's'} ·{' '}
                        {assessment.total_marks} marks · pass at {assessment.passing_marks}
                      </p>
                    </div>
                    <StatusBadge tone="accent">
                      {assessment.assignment_count} assigned
                    </StatusBadge>
                  </CardBody>
                </Card>
              ))}
            </div>
          )
        })()}
    </>
  )
}
