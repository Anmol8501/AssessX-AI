import { routes } from '@/app/routes'
import {
  ButtonLink,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui'
import { formatPercentage, useMyResults } from '@/features/exam/useResults'
import type { ResultSummary } from '@/features/exam/types'

/**
 * The candidate's own results.
 *
 * Only results the assessment is configured to release appear here — the server filters them, so
 * a withheld score is not merely hidden by this screen. Nothing on this page reveals an answer
 * key.
 */
export function CandidateResultsPage() {
  const { state, reload } = useMyResults()

  return (
    <>
      <PageHeader title="Results" description="Exams you have completed, and how they were marked." />

      {state.status === 'loading' && (
        <Card>
          <LoadingState title="Loading your results…" />
        </Card>
      )}

      {state.status === 'error' && (
        <Card>
          <ErrorState title="Could not load your results" description={state.message} onRetry={() => void reload()} />
        </Card>
      )}

      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <Card>
            <EmptyState
              title="No results yet"
              description="A result appears here once you finish an exam and your administrator releases the marks."
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {state.data.map((result) => (
              <ResultRow key={result.attempt_id} result={result} />
            ))}
          </div>
        ))}
    </>
  )
}

function ResultRow({ result }: { result: ResultSummary }) {
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-ink truncate text-[14.5px] font-semibold">{result.assessment_title}</p>
          <p className="text-ink-subtle mt-0.5 text-[12.5px]">
            Attempt {result.attempt_number}
            {result.attempt_status === 'TIME_EXPIRED' && ' · time expired'}
            {' · '}
            {result.correct_count} correct, {result.incorrect_count} incorrect, {result.unanswered_count}{' '}
            unanswered
          </p>
        </div>

        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-ink text-[16px] font-semibold tabular-nums">
              {result.score} / {result.maximum_score}
            </p>
            <p className="text-ink-subtle text-[12.5px] tabular-nums">{formatPercentage(result.percentage)}</p>
          </div>
          <StatusBadge tone={result.passed ? 'ok' : 'danger'}>{result.passed ? 'Passed' : 'Failed'}</StatusBadge>
          <ButtonLink to={routes.candidate.attempt(result.assessment_id)} variant="secondary" size="sm">
            View Result
          </ButtonLink>
        </div>
      </CardBody>
    </Card>
  )
}
