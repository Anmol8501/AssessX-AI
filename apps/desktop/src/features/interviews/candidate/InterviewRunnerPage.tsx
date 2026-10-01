import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { CheckIcon, SpinnerIcon } from '@/components/icons'
import { Button, CardBody, ConfirmDialog, ErrorState, Field, LoadingState, StatusBadge, Textarea } from '@/components/ui'
import { Centred } from '@/features/exam/ExamRunner'
import { ExamTimer } from '@/features/exam/ExamTimer'
import { DIFFICULTIES, QUESTION_TYPES, completionLabel } from '../labels'
import type { CandidateQuestion, SessionState } from '../types'
import { drafts, useInterviewSession } from '../useInterviewSession'

const MAX_ANSWER = 10_000

/**
 * The interview itself, full-screen (Phase 7A): one question at a time, a text answer, the server's
 * countdown. The server decides which question is shown and when the interview ends; this screen only
 * displays it and sends the answer to the question it was shown. "Saved" is shown only after the
 * server confirms. Phase 7A does not evaluate answers, so nothing here rates them.
 */
export function InterviewRunnerPage() {
  const { interviewId = '' } = useParams()
  const navigate = useNavigate()
  const session = useInterviewSession(interviewId)
  const { load } = session

  if (load.status === 'loading') {
    return (
      <Centred>
        <LoadingState title="Opening the interview…" />
      </Centred>
    )
  }
  if (load.status === 'error') {
    return (
      <Centred>
        <ErrorState
          title="Could not open the interview"
          description={load.message}
          onRetry={() => navigate(routes.candidate.interviewDetail(interviewId))}
        />
      </Centred>
    )
  }
  if (load.session.status === 'ACTIVE' && load.session.processing) {
    return <Processing state={load.session} session={session} />
  }
  if (load.session.status === 'COMPLETED' || !load.session.current) {
    return <Finished state={load.session} onDone={() => navigate(routes.candidate.interviews)} />
  }

  return <Running state={load.session} current={load.session.current} session={session} />
}

function Running({
  state,
  current,
  session,
}: {
  state: SessionState
  current: CandidateQuestion
  session: ReturnType<typeof useInterviewSession>
}) {
  // Keyed by item, so moving to the next question starts from that question's own draft.
  return <QuestionScreen key={current.item_id} state={state} current={current} session={session} />
}

function QuestionScreen({
  state,
  current,
  session,
}: {
  state: SessionState
  current: CandidateQuestion
  session: ReturnType<typeof useInterviewSession>
}) {
  const [text, setText] = useState(() => drafts.read(current.item_id))
  const [confirmEnd, setConfirmEnd] = useState(false)
  const trimmed = text.trim()

  const change = (value: string) => {
    setText(value)
    drafts.write(current.item_id, value)
  }
  const submit = async () => {
    if (await session.submit(trimmed)) drafts.write(current.item_id, '')
  }

  return (
    <div className="bg-surface flex h-full flex-col">
      <header className="border-line bg-card flex items-center justify-between gap-4 border-b px-6 py-3">
        <div className="min-w-0">
          <p className="text-ink-subtle text-[11.5px] tracking-wide uppercase">Interview</p>
          <h1 className="text-ink truncate text-[15px] font-semibold">{state.interview_title}</h1>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-ink-muted text-[13px] tabular-nums">
            Question {current.number} of {state.progress.primary_total}
          </p>
          <ExamTimer clock={{ remaining: session.remaining, online: session.online, finished: false }} />
          <Button variant="ghost" size="sm" onClick={() => setConfirmEnd(true)} disabled={session.busy}>
            End interview
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
          <div className="flex flex-wrap items-center gap-2">
            {current.kind === 'FOLLOW_UP' && <StatusBadge tone="accent">Follow-up to question {current.number}</StatusBadge>}
            <StatusBadge>{current.topic}</StatusBadge>
            <StatusBadge>{QUESTION_TYPES[current.question_type]}</StatusBadge>
            <StatusBadge>{DIFFICULTIES[current.difficulty]}</StatusBadge>
            {current.time_limit_seconds && (
              <span className="text-ink-subtle text-[12px]">Suggested time: {Math.round(current.time_limit_seconds / 60) || 1} min</span>
            )}
          </div>
          {current.context && (
            <p className="border-line bg-card text-ink-muted rounded-md border px-4 py-3 text-[13.5px] whitespace-pre-wrap">
              {current.context}
            </p>
          )}
          <h2 className="text-ink text-[18px] leading-relaxed font-semibold whitespace-pre-wrap" data-interview="question">
            {current.text}
          </h2>

          {session.notice && (
            <p className="bg-warn-soft text-warn rounded-md px-3 py-2 text-[13px]" role="alert">
              {session.notice}
            </p>
          )}

          <Field label="Your answer" hint={`${trimmed.length.toLocaleString()} / ${MAX_ANSWER.toLocaleString()} characters`}>
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                value={text}
                maxLength={MAX_ANSWER}
                onChange={(e) => change(e.target.value)}
                className="min-h-[220px]"
                disabled={session.busy}
              />
            )}
          </Field>
          <div className="flex items-center justify-between gap-3">
            <p className="text-ink-subtle text-[12px]">A submitted answer cannot be changed.</p>
            <Button onClick={() => void submit()} disabled={!trimmed || trimmed.length > MAX_ANSWER} loading={session.busy}>
              Submit answer
            </Button>
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={confirmEnd}
        title="End the interview now?"
        description="The current question and any remaining questions will be left unanswered. You cannot restart."
        confirmLabel="End interview"
        confirmVariant="danger"
        busy={session.busy}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false)
          void session.end()
        }}
      />
    </div>
  )
}

/** Between an answer and the next question while the answer is processed (Phase 7B). No score is shown. */
function Processing({ state, session }: { state: SessionState; session: ReturnType<typeof useInterviewSession> }) {
  return (
    <div className="bg-surface flex h-full flex-col">
      <header className="border-line bg-card flex items-center justify-between gap-4 border-b px-6 py-3">
        <h1 className="text-ink truncate text-[15px] font-semibold">{state.interview_title}</h1>
        <ExamTimer clock={{ remaining: session.remaining, online: session.online, finished: false }} />
      </header>
      <main className="flex flex-1 items-center justify-center p-8">
        <div className="text-center" role="status" aria-live="polite">
          <SpinnerIcon className="text-accent mx-auto text-[28px]" />
          <p className="text-ink mt-3 text-[15px] font-medium">Processing your answer…</p>
          <p className="text-ink-subtle mt-1 text-[12.5px]">
            Your answer has been saved. The next question will appear shortly. The timer keeps running.
          </p>
        </div>
      </main>
    </div>
  )
}

function Finished({ state, onDone }: { state: SessionState; onDone(): void }) {
  return (
    <Centred>
      <CardBody className="space-y-3 py-8 text-center">
        <CheckIcon className="text-ok mx-auto text-[32px]" />
        <h1 className="text-ink text-[17px] font-semibold">Interview complete</h1>
        <p className="text-ink-muted text-[13.5px]">
          {completionLabel(state.completion_reason)}. You answered {state.progress.primary_answered} of{' '}
          {state.progress.primary_total} questions
          {state.progress.follow_ups_answered ? ` and ${state.progress.follow_ups_answered} follow-up(s)` : ''}.
        </p>
        <p className="text-ink-subtle text-[12.5px]">Your answers have been recorded.</p>
        <Button onClick={onDone}>Back to My Interviews</Button>
      </CardBody>
    </Centred>
  )
}
