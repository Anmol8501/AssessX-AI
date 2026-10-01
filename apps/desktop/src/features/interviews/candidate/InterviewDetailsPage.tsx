import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { ArrowLeftIcon } from '@/components/icons'
import { Button, ButtonLink, Card, CardBody, CardHeader, ErrorState, InfoList, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import { DIFFICULTIES, INTERVIEW_TYPES, completionLabel, sessionStatusLabel } from '../labels'
import type { CandidateInterviewDetail } from '../types'
import { useMyInterview, useRefreshWhile } from '../useInterviews'

/**
 * One interview before it starts (or after it ends): what to expect, then Start or Resume.
 * Starting opens the full-screen interview; the server creates the session and owns the clock.
 */
export function InterviewDetailsPage() {
  const { interviewId = '' } = useParams()
  const navigate = useNavigate()
  const { state, reload } = useMyInterview(interviewId)
  useRefreshWhile(state.status === 'ready' && state.data.format === 'LIVE', reload)
  const back = (
    <Button variant="ghost" onClick={() => navigate(routes.candidate.interviews)} leadingIcon={<ArrowLeftIcon />}>
      My Interviews
    </Button>
  )

  if (state.status === 'loading') {
    return (
      <>
        <PageHeader title="Interview" actions={back} />
        <Card>
          <LoadingState title="Loading…" />
        </Card>
      </>
    )
  }
  if (state.status === 'error') {
    return (
      <>
        <PageHeader title="Interview" actions={back} />
        <Card>
          <ErrorState title="Could not load this interview" description={state.message} onRetry={() => void reload()} />
        </Card>
      </>
    )
  }

  const interview = state.data
  if (interview.format === 'LIVE') return <LiveDetails interview={interview} back={back} />
  const status = sessionStatusLabel(interview.session_status)
  const runner = routes.candidate.interviewSession(interview.interview_id)

  return (
    <>
      <PageHeader title={interview.title} description={interview.description ?? undefined} actions={back} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Before you begin" />
          <CardBody className="space-y-3 text-[13.5px]">
            {interview.instructions && <p className="text-ink whitespace-pre-wrap">{interview.instructions}</p>}
            <ul className="text-ink-muted list-disc space-y-1 pl-5">
              <li>Questions are shown one at a time. Type your answer and submit it to continue.</li>
              <li>A submitted answer cannot be changed, and questions cannot be skipped.</li>
              {interview.follow_ups_enabled && <li>Some questions have a follow-up question.</li>}
              <li>
                You have {interview.duration_minutes} minutes from when you start. The timer keeps running if you close
                the app, and the interview ends when time runs out.
              </li>
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Details" actions={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>} />
          <CardBody className="space-y-4">
            <InfoList
              items={[
                { label: 'Type', value: INTERVIEW_TYPES[interview.interview_type] },
                { label: 'Difficulty', value: DIFFICULTIES[interview.difficulty] },
                { label: 'Questions', value: String(interview.question_count) },
                { label: 'Duration', value: `${interview.duration_minutes} min` },
                { label: 'Topics', value: interview.topics.join(', ') },
              ]}
            />
            {interview.session_status === 'NOT_STARTED' && (
              <ButtonLink to={runner} className="w-full justify-center">
                Start interview
              </ButtonLink>
            )}
            {interview.session_status === 'ACTIVE' && (
              <ButtonLink to={runner} className="w-full justify-center">
                Resume interview
              </ButtonLink>
            )}
            {interview.session_status === 'COMPLETED' && (
              <p className="text-ink-muted text-[13px]">
                Completed — {completionLabel(interview.completion_reason).toLowerCase()}.
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}

/** Phase 7D: a live video interview — what to expect, and "Join live call" once the interviewer opens it. */
function LiveDetails({ interview, back }: { interview: CandidateInterviewDetail; back: ReactNode }) {
  return (
    <>
      <PageHeader title={interview.title} description={interview.description ?? undefined} actions={back} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Before you join" />
          <CardBody className="space-y-3 text-[13.5px]">
            {interview.instructions && <p className="text-ink whitespace-pre-wrap">{interview.instructions}</p>}
            <ul className="text-ink-muted list-disc space-y-1 pl-5">
              <li>This is a live video interview with an interviewer, planned for about {interview.duration_minutes} minutes.</li>
              <li>When the interviewer starts the call, a Join button appears here. Allow camera and microphone access when asked.</li>
              <li>You can mute, turn your camera off, share your screen and chat during the call.</li>
              <li>The call is not recorded. The chat is kept with the interview’s record.</li>
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-4">
            <InfoList
              items={[
                { label: 'Format', value: 'Live video interview' },
                { label: 'Type', value: INTERVIEW_TYPES[interview.interview_type] },
                { label: 'Planned length', value: `${interview.duration_minutes} min` },
                { label: 'Topics', value: interview.topics.join(', ') },
              ]}
            />
            {interview.open_call_id ? (
              <ButtonLink to={routes.candidate.interviewCall(interview.interview_id, interview.open_call_id)} className="w-full justify-center">
                Join live call
              </ButtonLink>
            ) : (
              <p className="text-ink-muted text-[13px]" role="status">
                Waiting for the interviewer to start the call…
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  )
}
