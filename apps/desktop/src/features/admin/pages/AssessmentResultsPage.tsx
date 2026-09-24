import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { ArrowLeftIcon } from '@/components/icons'
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui'
import { formatPercentage, useAssessmentResults } from '@/features/exam/useResults'

/**
 * One assessment's results, as a table.
 *
 * Scores and pass/fail only — no ranking, no averages, no charts, and nothing about proctoring,
 * because none of that exists yet. Every number shown is the server's stored evaluation; this
 * screen computes nothing.
 */
export function AssessmentResultsPage() {
  const { assessmentId = '' } = useParams()
  const navigate = useNavigate()
  const { state, reload } = useAssessmentResults(assessmentId)

  const back = (
    <Button variant="ghost" onClick={() => navigate(routes.admin.results)} leadingIcon={<ArrowLeftIcon />}>
      All results
    </Button>
  )

  if (state.status === 'loading') {
    return (
      <>
        <PageHeader title="Results" actions={back} />
        <Card>
          <LoadingState title="Loading results…" />
        </Card>
      </>
    )
  }

  if (state.status === 'error') {
    return (
      <>
        <PageHeader title="Results" actions={back} />
        <Card>
          <ErrorState title="Could not load these results" description={state.message} onRetry={() => void reload()} />
        </Card>
      </>
    )
  }

  const { assessment_title, total_marks, passing_marks, assigned_count, results } = state.data

  return (
    <>
      <PageHeader
        title={assessment_title}
        description={`${total_marks} marks · pass at ${passing_marks} · ${assigned_count} candidate${
          assigned_count === 1 ? '' : 's'
        } assigned`}
        actions={back}
      />

      {results.length === 0 ? (
        <Card>
          <EmptyState
            title="No results yet"
            description="Results appear here as assigned candidates submit or run out of time."
          />
        </Card>
      ) : (
        <Card>
          <CardBody className="px-0 py-0">
            <table className="w-full text-left">
              <thead>
                <tr className="border-line text-ink-subtle border-b text-[12px] tracking-wide uppercase">
                  <th scope="col" className="px-5 py-3 font-medium">
                    Candidate
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Score
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Percentage
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Breakdown
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {results.map((result) => (
                  <tr key={result.attempt_id}>
                    <td className="px-5 py-3">
                      <p className="text-ink text-[13.5px] font-medium">{result.candidate_name}</p>
                      <p className="text-ink-subtle text-[12px]">
                        {result.candidate_roll_number ?? result.candidate_email}
                        {result.attempt_status === 'TIME_EXPIRED' && ' · time expired'}
                      </p>
                    </td>
                    <td className="text-ink px-5 py-3 text-[13.5px] tabular-nums">
                      {result.score} / {result.maximum_score}
                    </td>
                    <td className="text-ink px-5 py-3 text-[13.5px] tabular-nums">
                      {formatPercentage(result.percentage)}
                    </td>
                    <td className="text-ink-subtle px-5 py-3 text-[12.5px] tabular-nums">
                      {result.correct_count} / {result.incorrect_count} / {result.unanswered_count}
                      <span className="sr-only"> correct, incorrect, unanswered</span>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge tone={result.passed ? 'ok' : 'danger'}>
                        {result.passed ? 'Passed' : 'Failed'}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <p className="text-ink-subtle mt-3 text-[12px]">
        Breakdown shows correct / incorrect / unanswered questions.
      </p>
    </>
  )
}
