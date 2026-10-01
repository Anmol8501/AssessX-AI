import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { routes } from '@/app/routes'
import { ArrowLeftIcon } from '@/components/icons'
import { Button, Card, CardBody, EmptyState, ErrorState, LoadingState, PageHeader, StatCard, StatusBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { evaluationStateLabel, outcomeLabel, reviewStatusLabel } from './labels'
import type { ReviewStatus } from './types'
import { useReportQueue, type ReportFilters } from './useReport'

const STATUSES: ReviewStatus[] = ['UNREVIEWED', 'IN_REVIEW', 'REVIEWED']
const NONE: ReportFilters = { reviewStatus: null, sessionStatus: null, evaluationState: null, interviewId: null }

/**
 * Interview reports & reviews (Phase 7C): every interview session, newest first, with its interview
 * status, AI evaluation state, AI score (a signal) and human review status. Never ranked or sorted by
 * score.
 */
export function ReportQueuePage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<ReportFilters>(NONE)
  const { state, reload, loadMore, loadingMore } = useReportQueue(filters)
  const counts = state.status === 'ready' ? state.data.counts : null

  return (
    <>
      <PageHeader
        title="Interview reports"
        description="Interview sessions with their AI evaluation and human review status."
        actions={
          <Button variant="ghost" onClick={() => navigate(routes.admin.interviews)} leadingIcon={<ArrowLeftIcon />}>
            Interviews
          </Button>
        }
      />
      <div className="grid grid-cols-3 gap-4">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={filters.reviewStatus === s}
            onClick={() => setFilters((f) => ({ ...f, reviewStatus: f.reviewStatus === s ? null : s }))}
            className={cn('rounded-lg text-left', filters.reviewStatus === s && 'ring-accent ring-2')}
          >
            <StatCard label={reviewStatusLabel(s).label} value={counts ? counts[s] : null} />
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['COMPLETED', 'ACTIVE'] as const).map((s) => (
          <Button key={s} size="sm" variant={filters.sessionStatus === s ? 'primary' : 'secondary'} onClick={() => setFilters((f) => ({ ...f, sessionStatus: f.sessionStatus === s ? null : s }))}>
            {s === 'COMPLETED' ? 'Completed interviews' : 'In progress'}
          </Button>
        ))}
        {(['PARTIAL', 'PENDING'] as const).map((s) => (
          <Button key={s} size="sm" variant={filters.evaluationState === s ? 'primary' : 'secondary'} onClick={() => setFilters((f) => ({ ...f, evaluationState: f.evaluationState === s ? null : s }))}>
            {evaluationStateLabel(s)}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setFilters(NONE)}>
          Clear filters
        </Button>
      </div>

      <Card className="mt-4">
        {state.status === 'loading' && <LoadingState title="Loading reports…" />}
        {state.status === 'error' && <ErrorState title="Could not load reports" description={state.message} onRetry={reload} />}
        {state.status === 'ready' && state.data.items.length === 0 && <EmptyState title="Nothing to show" description="Interview sessions appear here once candidates start them." />}
        {state.status === 'ready' && state.data.items.length > 0 && (
          <CardBody className="px-0 py-0">
            <table className="w-full text-left" aria-label="Interview reports">
              <thead>
                <tr className="border-line text-ink-subtle border-b text-[12px] tracking-wide uppercase">
                  <th scope="col" className="px-5 py-3 font-medium">Candidate</th>
                  <th scope="col" className="px-5 py-3 font-medium">Interview</th>
                  <th scope="col" className="px-5 py-3 font-medium">AI evaluation</th>
                  <th scope="col" className="px-5 py-3 font-medium">Human review</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {state.data.items.map((row) => (
                  <tr key={row.session_id}>
                    <td className="px-5 py-3">
                      <Link to={routes.admin.interviewReport(row.interview_id, row.session_id)} className="text-accent text-[13.5px] font-medium hover:underline">
                        {row.candidate_name}
                      </Link>
                      <p className="text-ink-subtle text-[12px]">
                        {row.interview_title}
                        {row.candidate_roll_number ? ` · ${row.candidate_roll_number}` : ''}
                      </p>
                    </td>
                    <td className="text-ink-muted px-5 py-3 text-[12.5px]">
                      {row.session_status === 'COMPLETED' ? 'Completed' : 'In progress'} · {row.answered} answered
                    </td>
                    <td className="px-5 py-3 text-[12.5px]">
                      <span className="text-ink tabular-nums">{row.ai_score === null ? '—' : `${row.ai_score} / 100`}</span>
                      <p className="text-ink-subtle text-[11.5px]">{evaluationStateLabel(row.evaluation_state)}</p>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge tone={reviewStatusLabel(row.review_status).tone}>{reviewStatusLabel(row.review_status).label}</StatusBadge>
                      {row.review_outcome && <p className="text-ink-subtle mt-0.5 text-[11.5px]">{outcomeLabel(row.review_outcome).label}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        )}
      </Card>
      {state.status === 'ready' && state.data.next_cursor && (
        <div className="mt-3">
          <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
      {state.status === 'ready' && <p className="text-ink-subtle mt-3 text-[12px]">{state.data.note}</p>}
    </>
  )
}
