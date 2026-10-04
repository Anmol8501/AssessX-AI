import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { ArrowLeftIcon } from '@/components/icons'
import {
  Button,
  ButtonLink,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui'
import { CodingAnalyticsPanel } from '@/features/coding/admin/CodingAnalyticsPanel'
import { sectionText } from '@/features/exam/resultText'
import { formatPercentage, useAssessmentResults } from '@/features/exam/useResults'
import { EvidenceTimeline } from '../evidence/EvidenceTimeline'
import { AttemptRiskPanel } from '../risk/AttemptRiskPanel'

/**
 * One assessment's results, as a table.
 *
 * Scores and pass/fail — no ranking, no averages, no charts. Every number shown is the server's
 * stored evaluation; this screen computes nothing. Each row can open that attempt's proctoring risk
 * (Phase 6A), loaded on demand for that one attempt — a summary for review, not a verdict.
 */
export function AssessmentResultsPage() {
  const { assessmentId = '' } = useParams()
  const navigate = useNavigate()
  const { state, reload } = useAssessmentResults(assessmentId)
  const [riskFor, setRiskFor] = useState<{ attemptId: string; name: string } | null>(null)

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
                  <th scope="col" className="px-5 py-3 font-medium">
                    <span className="sr-only">Proctoring risk</span>
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
                      {result.coding_maximum !== null && (
                        <span className="text-ink-subtle block text-[12px]">
                          {result.mcq_maximum !== null && `MCQ ${sectionText(result.mcq_score, result.mcq_maximum)} · `}
                          Code {sectionText(result.coding_score, result.coding_maximum)}
                        </span>
                      )}
                    </td>
                    <td className="text-ink px-5 py-3 text-[13.5px] tabular-nums">
                      {formatPercentage(result.percentage)}
                    </td>
                    <td className="text-ink-subtle px-5 py-3 text-[12.5px] tabular-nums">
                      {result.correct_count} / {result.incorrect_count} / {result.unanswered_count}
                      <span className="sr-only"> correct, incorrect, unanswered</span>
                      {result.partial_count ? <span className="block">{result.partial_count} partly correct</span> : null}
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge tone={result.passed ? 'ok' : 'danger'}>
                        {result.passed ? 'Passed' : 'Failed'}
                      </StatusBadge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRiskFor({ attemptId: result.attempt_id, name: result.candidate_name })}
                      >
                        Risk & evidence
                      </Button>
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
      {results.length > 0 && <CodingAnalyticsPanel assessmentId={assessmentId} />}
      {riskFor && <RiskDialog {...riskFor} onClose={() => setRiskFor(null)} />}
    </>
  )
}

/** One attempt's risk (Phase 6A) and evidence timeline (Phase 6B), fetched only when opened. */
function RiskDialog({ attemptId, name, onClose }: { attemptId: string; name: string; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="bg-ink/60 fixed inset-0 z-50 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Risk and evidence — ${name}`}
      onClick={onClose}
    >
      <div className="bg-card max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-ink text-[15px] font-semibold">{name}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <AttemptRiskPanel attemptId={attemptId} live={false} />
        <EvidenceTimeline attemptId={attemptId} />
        <div className="mt-4 flex justify-end">
          <ButtonLink to={routes.admin.review(attemptId)} size="sm">
            Open review
          </ButtonLink>
        </div>
      </div>
    </div>
  )
}
