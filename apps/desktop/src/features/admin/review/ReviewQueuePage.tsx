import { useState } from 'react'
import { Link } from 'react-router'
import { routes } from '@/app/routes'
import { Button, Card, CardBody, EmptyState, ErrorState, Input, LoadingState, PageHeader, StatCard, StatusBadge } from '@/components/ui'
import type { AssessmentSummary } from '@/features/assessments/types'
import { useAssessmentList } from '@/features/assessments/useAssessments'
import { cn } from '@/lib/cn'
import { riskLevel } from '../risk/labels'
import { dateTime, outcomeLabel, reviewStatusLabel } from './labels'
import type { ReviewStatus } from './types'
import { useReviewQueue, type QueueFilters } from './useReviewQueue'

const STATUSES: ReviewStatus[] = ['UNREVIEWED', 'IN_REVIEW', 'REVIEWED']

/**
 * Review queue (Phase 6C): every proctored attempt with its review status.
 *
 * The "Risk signal" column is the system's current Phase 6A level — there to help decide what to
 * look at first. The "Outcome" column is the administrator's recorded decision. They sit in separate
 * columns because neither implies the other. Filters are the ones the data supports directly
 * (status, assessment, finish date); risk is derived per attempt, so it is shown but not filtered.
 */
export function ReviewQueuePage() {
  const [filters, setFilters] = useState<QueueFilters>({ status: null, assessmentId: null, finishedFrom: null, finishedTo: null })
  const { state, reload, loadMore, loadingMore } = useReviewQueue(filters)
  const assessments = useAssessmentList()
  const published =
    assessments.state.status === 'ready' ? assessments.state.data.filter((a: AssessmentSummary) => a.status === 'PUBLISHED') : []
  const counts = state.status === 'ready' ? state.queue.counts : null

  return (
    <>
      <PageHeader title="Reviews" description="Proctored attempts awaiting, under or after human review." />

      <div className="grid grid-cols-3 gap-4">
        {STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilters((f) => ({ ...f, status: f.status === status ? null : status }))}
            aria-pressed={filters.status === status}
            className={cn('rounded-lg text-left', filters.status === status && 'ring-accent ring-2')}
          >
            <StatCard label={reviewStatusLabel(status).label} value={counts ? counts[status] : null} />
          </button>
        ))}
      </div>

      <Card className="mt-4">
        <CardBody className="flex flex-wrap items-end gap-3">
          <label className="text-ink-muted text-[12.5px]">
            Assessment
            <select
              className="border-line-strong bg-card text-ink mt-1 block h-10 rounded-md border px-2 text-[13.5px]"
              value={filters.assessmentId ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, assessmentId: e.target.value || null }))}
            >
              <option value="">All assessments</option>
              {published.map((a: AssessmentSummary) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <label className="text-ink-muted text-[12.5px]">
            Finished from
            <Input
              type="date"
              className="mt-1"
              value={filters.finishedFrom ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, finishedFrom: e.target.value || null }))}
            />
          </label>
          <label className="text-ink-muted text-[12.5px]">
            Finished to
            <Input
              type="date"
              className="mt-1"
              value={filters.finishedTo ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, finishedTo: e.target.value || null }))}
            />
          </label>
          <Button
            variant="ghost"
            onClick={() => setFilters({ status: null, assessmentId: null, finishedFrom: null, finishedTo: null })}
          >
            Clear filters
          </Button>
        </CardBody>
      </Card>

      <Card className="mt-4">
        {state.status === 'loading' && <LoadingState title="Loading the review queue…" />}
        {state.status === 'error' && <ErrorState title="Could not load the review queue" description={state.message} onRetry={reload} />}
        {state.status === 'ready' && state.queue.items.length === 0 && (
          <EmptyState title="Nothing to show" description="Proctored attempts appear here once candidates start them." />
        )}
        {state.status === 'ready' && state.queue.items.length > 0 && (
          <CardBody className="px-0 py-0">
            <table className="w-full text-left" aria-label="Review queue">
              <thead>
                <tr className="border-line text-ink-subtle border-b text-[12px] tracking-wide uppercase">
                  <th scope="col" className="px-5 py-3 font-medium">Candidate</th>
                  <th scope="col" className="px-5 py-3 font-medium">Finished</th>
                  <th scope="col" className="px-5 py-3 font-medium">Risk signal · system</th>
                  <th scope="col" className="px-5 py-3 font-medium">Review</th>
                  <th scope="col" className="px-5 py-3 font-medium">Outcome · human</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {state.queue.items.map((item) => {
                  const risk = riskLevel(item.riskLevel)
                  const status = reviewStatusLabel(item.reviewStatus)
                  return (
                    <tr key={item.attemptId}>
                      <td className="px-5 py-3">
                        <Link to={routes.admin.review(item.attemptId)} className="text-accent text-[13.5px] font-medium hover:underline">
                          {item.candidateName}
                        </Link>
                        <p className="text-ink-subtle text-[12px]">
                          {item.assessmentTitle} · attempt {item.attemptNumber}
                          {item.candidateRollNumber ? ` · ${item.candidateRollNumber}` : ''}
                        </p>
                      </td>
                      <td className="text-ink-muted px-5 py-3 text-[12.5px]">
                        {item.finalizedAt ? dateTime(item.finalizedAt) : 'In progress'}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge tone={risk.tone} dot>
                          {risk.label} · {item.riskScore}
                        </StatusBadge>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </td>
                      <td className="px-5 py-3 text-[12.5px]">
                        {item.outcome ? (
                          <>
                            <StatusBadge tone={outcomeLabel(item.outcome).tone}>{outcomeLabel(item.outcome).label}</StatusBadge>
                            {item.reviewedBy && <p className="text-ink-subtle mt-0.5 text-[11.5px]">{item.reviewedBy.name}</p>}
                          </>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardBody>
        )}
      </Card>

      {state.status === 'ready' && state.queue.nextCursor && (
        <div className="mt-3">
          <Button variant="secondary" onClick={loadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
      {state.status === 'ready' && <p className="text-ink-subtle mt-3 text-[12px]">{state.queue.interpretation}</p>}
    </>
  )
}
