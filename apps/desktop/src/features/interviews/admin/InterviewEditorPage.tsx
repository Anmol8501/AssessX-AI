import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { ArrowLeftIcon, InfoIcon } from '@/components/icons'
import { Button, ButtonLink, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import type { CandidateSummary } from '@/features/assessments/types'
import { fetchAllPages } from '@/features/session'
import { completionLabel, interviewStatusLabel, sessionStatusLabel } from '../labels'
import { formatElapsed } from '../call/callLogic'
import type { CallSummary } from '../call/types'
import type { InterviewAssignment, InterviewDetail } from '../types'
import { describeError, useInterview, useInterviewActions } from '../useInterviews'
import { InterviewForm } from './InterviewForm'
import { QuestionsSection } from './QuestionsSection'

/**
 * One interview (Phase 7A): its configuration and question bank while a draft; publishing (refused
 * by the server until enough eligible questions exist); and, once published, assigning candidates and
 * following their progress. A published interview is locked — unpublish (with nobody assigned) to edit.
 */
export function InterviewEditorPage() {
  const { interviewId = '' } = useParams()
  const navigate = useNavigate()
  const { state, reload } = useInterview(interviewId)
  const actions = useInterviewActions()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const back = (
    <Button variant="ghost" onClick={() => navigate(routes.admin.interviews)} leadingIcon={<ArrowLeftIcon />}>
      All interviews
    </Button>
  )

  if (state.status === 'loading') {
    return (
      <>
        <PageHeader title="Interview" actions={back} />
        <Card>
          <LoadingState title="Loading the interview…" />
        </Card>
      </>
    )
  }
  if (state.status === 'error') {
    return (
      <>
        <PageHeader title="Interview" actions={back} />
        <Card>
          <ErrorState title="Could not load the interview" description={state.message} onRetry={() => void reload()} />
        </Card>
      </>
    )
  }

  const interview = state.data
  const draft = interview.status === 'DRAFT'
  const status = interviewStatusLabel(interview.status)

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      await reload()
    } catch (err) {
      setError(describeError(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={interview.title}
        description={
          interview.format === 'LIVE'
            ? `Live video interview · ${interview.duration_minutes} min planned`
            : `${interview.question_count} question(s) per session · ${interview.duration_minutes} min`
        }
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {draft ? (
              <Button onClick={() => void run(() => actions.publish(interview.id), 'Could not publish.')} disabled={busy || interview.issues.length > 0}>
                Publish
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void run(() => actions.unpublish(interview.id), 'Could not unpublish.')} disabled={busy}>
                Unpublish
              </Button>
            )}
            {back}
          </div>
        }
      />

      {error && (
        <p className="bg-danger-soft text-danger mb-4 rounded-md px-3 py-2 text-[13px]" role="alert">
          {error}
        </p>
      )}
      {draft && interview.issues.length > 0 && (
        <Card className="mb-4">
          <CardBody>
            <p className="text-ink text-[13px] font-medium">Before publishing:</p>
            <ul className="text-ink-muted mt-1 list-disc pl-5 text-[13px]" aria-label="Publishing issues">
              {interview.issues.map((issue) => (
                <li key={issue.field + issue.message}>{issue.message}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {!draft && (
        <p className="text-ink-muted mb-4 flex items-start gap-2 text-[13px]">
          <InfoIcon className="mt-0.5 shrink-0" />
          {interview.format === 'LIVE'
            ? 'Published interviews are locked. Start a live call with an assigned candidate below; the questions are your guide during the call.'
            : 'Published interviews are locked so every candidate gets the same questions. Unpublish (with no one assigned) to edit.'}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Configuration" />
            <CardBody>
              <InterviewForm
                key={interview.updated_at}
                initial={interview}
                submitLabel="Save changes"
                disabled={!draft}
                busy={busy}
                onSubmit={(input) => void run(() => actions.update(interview.id, input), 'Could not save the interview.')}
              />
            </CardBody>
          </Card>
          {draft && (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete interview
            </Button>
          )}
        </div>
        <div className="space-y-4">
          <QuestionsSection interview={interview} onChanged={() => void reload()} />
          {!draft && <AssignmentsPanel interview={interview} />}
          {interview.format === 'LIVE' && <CallHistory interview={interview} />}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this interview?"
        description="Its questions are deleted with it. This cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
        busy={busy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          void run(async () => {
            await actions.remove(interview.id)
            navigate(routes.admin.interviews)
          }, 'Could not delete the interview.')
        }
      />
    </>
  )
}

function AssignmentsPanel({ interview }: { interview: InterviewDetail }) {
  const navigate = useNavigate()
  const actions = useInterviewActions()
  const live = interview.format === 'LIVE'
  const [rows, setRows] = useState<InterviewAssignment[] | null>(null)
  const [candidates, setCandidates] = useState<CandidateSummary[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      Promise.all([actions.assignments(interview.id), fetchAllPages<CandidateSummary>('/api/v1/candidates')])
        .then(([assigned, people]) => {
          setRows(assigned)
          setCandidates(people)
        })
        .catch((err: unknown) => setError(describeError(err, 'Could not load assignments.'))),
    [actions, interview.id],
  )
  useEffect(() => {
    void load()
  }, [load])

  if (rows === null) {
    return (
      <Card>
        <LoadingState title="Loading assignments…" />
      </Card>
    )
  }
  const assigned = new Set(rows.map((r) => r.candidate_id))
  const available = candidates.filter((c) => c.is_active && !assigned.has(c.id))

  const startCall = async (candidateId: string) => {
    setBusy(true)
    setError(null)
    try {
      const call = await actions.openCall(interview.id, candidateId)
      navigate(routes.admin.interviewCall(interview.id, call.call_id))
    } catch (err) {
      setError(describeError(err, 'Could not start the call.'))
      setBusy(false)
    }
  }

  const assign = async () => {
    setBusy(true)
    setError(null)
    try {
      await actions.assign(interview.id, [...selected])
      setSelected(new Set())
      await load()
    } catch (err) {
      setError(describeError(err, 'Could not assign the candidates.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Candidates"
        description={live ? 'Start a live video call with a candidate. Nothing is recorded.' : 'Progress. Open a report for answers, AI evaluations and the human review.'}
      />
      <CardBody className="space-y-4">
        {error && (
          <p className="bg-danger-soft text-danger rounded-md px-3 py-2 text-[13px]" role="alert">
            {error}
          </p>
        )}
        {rows.length === 0 ? (
          <EmptyState title="Nobody assigned yet" />
        ) : (
          <ul className="divide-line divide-y" aria-label="Assigned candidates">
            {rows.map((row) => {
              const s = sessionStatusLabel(row.session_status)
              return (
                <li key={row.candidate_id} className="py-2 text-[13px]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-ink font-medium">{row.candidate_name}</p>
                      <p className="text-ink-subtle text-[12px]">
                        {row.candidate_roll_number ?? row.candidate_email}
                        {live ? (
                          row.open_call_id ? ' · call in progress' : ''
                        ) : (
                          <>
                            {` · ${row.primary_answered}/${row.primary_total} answered`}
                            {row.follow_ups_answered ? ` · ${row.follow_ups_answered} follow-up(s)` : ''}
                            {row.completion_reason ? ` · ${completionLabel(row.completion_reason)}` : ''}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {live && (
                        <Button size="sm" variant={row.open_call_id ? 'primary' : 'secondary'} disabled={busy} onClick={() => void startCall(row.candidate_id)}>
                          {row.open_call_id ? 'Rejoin call' : 'Start live call'}
                        </Button>
                      )}
                      {row.session_id && (
                        <ButtonLink to={routes.admin.interviewReport(interview.id, row.session_id)} variant="ghost" size="sm">
                          Open report
                        </ButtonLink>
                      )}
                      {!live && <StatusBadge tone={s.tone}>{s.label}</StatusBadge>}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {available.length > 0 && (
          <div className="space-y-2">
            <p className="text-ink text-[13px] font-medium">Assign candidates</p>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {available.map((c) => (
                <Checkbox
                  key={c.id}
                  className="flex"
                  label={`${c.name} · ${c.roll_number ?? c.email}`}
                  checked={selected.has(c.id)}
                  onChange={(e) =>
                    setSelected((current) => {
                      const next = new Set(current)
                      if (e.target.checked) next.add(c.id)
                      else next.delete(c.id)
                      return next
                    })
                  }
                />
              ))}
            </div>
            <Button size="sm" disabled={selected.size === 0} loading={busy} onClick={() => void assign()}>
              Assign {selected.size || ''}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/** Phase 7D: the interview's calls, newest first — each opens its record (chat, notes, duration). */
function CallHistory({ interview }: { interview: InterviewDetail }) {
  const actions = useInterviewActions()
  const [calls, setCalls] = useState<CallSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    actions
      .calls(interview.id)
      .then(setCalls)
      .catch((err: unknown) => setError(describeError(err, 'Could not load the calls.')))
  }, [actions, interview.id])

  return (
    <Card>
      <CardHeader title="Calls" description="Each live call's record: when it ran, its chat and your notes. No video or audio is kept." />
      <CardBody>
        {error && (
          <p className="bg-danger-soft text-danger rounded-md px-3 py-2 text-[13px]" role="alert">
            {error}
          </p>
        )}
        {calls === null && !error && <LoadingState title="Loading calls…" />}
        {calls && calls.length === 0 && <EmptyState title="No calls yet" />}
        {calls && calls.length > 0 && (
          <ul className="divide-line divide-y" aria-label="Calls">
            {calls.map((c) => (
              <li key={c.call_id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                <div className="min-w-0">
                  <p className="text-ink">{new Date(c.opened_at).toLocaleString()}</p>
                  <p className="text-ink-subtle text-[12px]">
                    by {c.opened_by.name} · {formatElapsed(c.duration_seconds)}
                    {c.candidate_joined_at ? '' : ' · candidate did not join'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ButtonLink to={routes.admin.interviewCall(interview.id, c.call_id)} variant="ghost" size="sm">
                    {c.status === 'OPEN' ? 'Rejoin' : 'Open record'}
                  </ButtonLink>
                  <StatusBadge tone={c.status === 'OPEN' ? 'info' : 'neutral'}>{c.status === 'OPEN' ? 'In progress' : 'Ended'}</StatusBadge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
