import { Link } from 'react-router'
import { routes } from '@/app/routes'
import { ButtonLink, Card, CardBody, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import { DIFFICULTIES, INTERVIEW_TYPES, completionLabel, sessionStatusLabel } from '../labels'
import { useMyInterviews, useRefreshWhile } from '../useInterviews'

/** The candidate's assigned interviews (Phase 7A); a live one shows "Join live call" once its call is open (7D). */
export function MyInterviewsPage() {
  const { state, reload } = useMyInterviews()
  useRefreshWhile(state.status === 'ready' && state.data.some((i) => i.format === 'LIVE'), reload)

  return (
    <>
      <PageHeader title="My Interviews" description="Interviews assigned to you." />
      {state.status === 'loading' && (
        <Card>
          <LoadingState title="Loading interviews…" />
        </Card>
      )}
      {state.status === 'error' && (
        <Card>
          <ErrorState title="Could not load your interviews" description={state.message} onRetry={() => void reload()} />
        </Card>
      )}
      {state.status === 'ready' && state.data.length === 0 && (
        <Card>
          <EmptyState title="No interviews yet" description="Interviews assigned to you will appear here." />
        </Card>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <div className="space-y-3">
          {state.data.map((interview) => {
            const status = sessionStatusLabel(interview.session_status)
            const live = interview.format === 'LIVE'
            return (
              <Card key={interview.interview_id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <Link
                      to={routes.candidate.interviewDetail(interview.interview_id)}
                      className="text-accent text-[14.5px] font-semibold hover:underline"
                    >
                      {interview.title}
                    </Link>
                    <p className="text-ink-subtle mt-0.5 text-[12.5px]">
                      {live ? (
                        `Live video interview · ${INTERVIEW_TYPES[interview.interview_type]} · ${interview.duration_minutes} min`
                      ) : (
                        <>
                          {INTERVIEW_TYPES[interview.interview_type]} · {DIFFICULTIES[interview.difficulty]} ·{' '}
                          {interview.question_count} questions · {interview.duration_minutes} min
                          {interview.completion_reason ? ` · ${completionLabel(interview.completion_reason)}` : ''}
                        </>
                      )}
                    </p>
                  </div>
                  {live ? (
                    interview.open_call_id ? (
                      <ButtonLink to={routes.candidate.interviewCall(interview.interview_id, interview.open_call_id)}>Join live call</ButtonLink>
                    ) : (
                      <StatusBadge tone="neutral">Waiting for the interviewer</StatusBadge>
                    )
                  ) : (
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
