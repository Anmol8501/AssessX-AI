import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { ArrowLeftIcon } from '@/components/icons'
import { Button, Card, ErrorState, InfoList, LoadingState, PageHeader } from '@/components/ui'
import { EvidenceTimeline } from '../evidence/EvidenceTimeline'
import { AttemptRiskPanel } from '../risk/AttemptRiskPanel'
import { dateTime } from './labels'
import { ReviewPanel } from './ReviewPanel'
import { marksById } from './types'
import { useReview } from './useReview'

const ATTEMPT_STATUS: Record<string, string> = {
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  TIME_EXPIRED: 'Time expired',
}

/**
 * Attempt review (Phase 6C): one attempt, the system's signals on one side and the administrator's
 * review on the other.
 *
 * Left, **system-generated**: the Phase 6A risk panel and the Phase 6B evidence timeline, reused
 * as they are — with the reviewer's confirm/dismiss marks added to the timeline while the review is
 * open. Right, **human-authored**: status, notes, outcome and history. The two are labelled apart
 * because they are different things: a risk level is a signal, the outcome is a person's decision.
 */
export function AttemptReviewPage() {
  const { attemptId = '' } = useParams()
  const navigate = useNavigate()
  const review = useReview(attemptId)
  const { state } = review

  const back = (
    <Button variant="ghost" onClick={() => navigate(routes.admin.reviews)} leadingIcon={<ArrowLeftIcon />}>
      Review queue
    </Button>
  )

  if (state.status === 'loading') {
    return (
      <>
        <PageHeader title="Attempt review" actions={back} />
        <Card>
          <LoadingState title="Loading the review…" />
        </Card>
      </>
    )
  }
  if (state.status === 'error') {
    return (
      <>
        <PageHeader title="Attempt review" actions={back} />
        <Card>
          <ErrorState title="Could not load this review" description={state.message} onRetry={() => void review.reload()} />
        </Card>
      </>
    )
  }

  const { context } = state.review
  const live = context.attemptStatus === 'IN_PROGRESS'

  return (
    <>
      <PageHeader
        title={context.candidateName}
        description={`${context.assessmentTitle} · attempt ${context.attemptNumber}${
          context.candidateRollNumber ? ` · ${context.candidateRollNumber}` : ''
        }`}
        actions={back}
      />

      <Card className="mb-4 px-5 py-3">
        <InfoList
          items={[
            { label: 'Attempt', value: ATTEMPT_STATUS[context.attemptStatus] ?? context.attemptStatus },
            { label: 'Started', value: dateTime(context.startedAt) },
            { label: 'Finished', value: context.finalizedAt ? dateTime(context.finalizedAt) : '—' },
          ]}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div aria-label="System-generated signals">
          <p className="text-ink-subtle text-[11.5px] font-medium tracking-wide uppercase">
            System-generated · signals for review, not a verdict
          </p>
          <AttemptRiskPanel attemptId={attemptId} live={live} />
          <EvidenceTimeline
            attemptId={attemptId}
            review={{
              marks: marksById(state.review),
              editable: state.review.status === 'IN_REVIEW',
              onMark: review.mark,
            }}
          />
        </div>
        <div>
          <p className="text-ink-subtle mb-4 text-[11.5px] font-medium tracking-wide uppercase">Human-authored · your decision</p>
          <ReviewPanel review={state.review} actions={review} />
        </div>
      </div>
    </>
  )
}
