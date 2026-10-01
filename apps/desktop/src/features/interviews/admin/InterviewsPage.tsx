import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { routes } from '@/app/routes'
import { Button, ButtonLink, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import { DIFFICULTIES, INTERVIEW_TYPES, interviewStatusLabel } from '../labels'
import { describeError, useInterviewActions, useInterviewList } from '../useInterviews'
import { EMPTY_INTERVIEW } from '../types'
import { InterviewForm } from './InterviewForm'

/**
 * Interviews (Phase 7A): the list, and creating a new one. An interview is configured and its
 * questions written here; candidates take it from their own "My Interviews". Nothing in Phase 7A
 * evaluates answers.
 */
export function InterviewsPage() {
  const { state, reload } = useInterviewList()
  const actions = useInterviewActions()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <PageHeader
        title="Interviews"
        description="Structured interviews: configure the questions, publish, and assign candidates."
        actions={
          !creating && (
            <div className="flex gap-2">
              <ButtonLink to={routes.admin.interviewReports} variant="secondary">
                Reports &amp; reviews
              </ButtonLink>
              <Button onClick={() => setCreating(true)}>New interview</Button>
            </div>
          )
        }
      />

      {creating && (
        <Card className="mb-4">
          <CardHeader title="New interview" actions={<Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>} />
          <CardBody>
            <InterviewForm
              initial={EMPTY_INTERVIEW}
              submitLabel="Create interview"
              busy={busy}
              error={error}
              onSubmit={async (input) => {
                setBusy(true)
                setError(null)
                try {
                  const created = await actions.create(input)
                  navigate(routes.admin.interviewDetail(created.id))
                } catch (err) {
                  setError(describeError(err, 'Could not create the interview.'))
                } finally {
                  setBusy(false)
                }
              }}
            />
          </CardBody>
        </Card>
      )}

      {state.status === 'loading' && (
        <Card>
          <LoadingState title="Loading interviews…" />
        </Card>
      )}
      {state.status === 'error' && (
        <Card>
          <ErrorState title="Could not load interviews" description={state.message} onRetry={() => void reload()} />
        </Card>
      )}
      {state.status === 'ready' && state.data.length === 0 && !creating && (
        <Card>
          <EmptyState title="No interviews yet" description="Create an interview to configure its questions." />
        </Card>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <div className="space-y-3">
          {state.data.map((interview) => {
            const status = interviewStatusLabel(interview.status)
            return (
              <Card key={interview.id}>
                <CardBody className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <Link to={routes.admin.interviewDetail(interview.id)} className="text-accent text-[14.5px] font-semibold hover:underline">
                      {interview.title}
                    </Link>
                    <p className="text-ink-subtle mt-0.5 text-[12.5px]">
                      {INTERVIEW_TYPES[interview.interview_type]} · {DIFFICULTIES[interview.difficulty]} · asks{' '}
                      {interview.question_count} of {interview.primary_question_count} question(s) · {interview.duration_minutes} min
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone="accent">{interview.assignment_count} assigned</StatusBadge>
                    <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
