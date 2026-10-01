import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { Button, ConfirmDialog } from '@/components/ui'
import { useApi } from '@/features/session'
import { cn } from '@/lib/cn'
import { DIFFICULTIES } from '../labels'
import { orderQuestions } from '../types'
import { describeError, useInterview } from '../useInterviews'
import { formatElapsed } from './callLogic'
import { CallMessage, CallScreen, ChatPanel } from './CallScreen'
import type { AdminCall, CallNote } from './types'
import { useCall } from './useCall'

const MAX_NOTE = 4000

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; call: AdminCall }

/**
 * The interviewer's side of a live interview (Phase 7D): the call itself, with the question bank as a
 * guide (the expected concepts are for the interviewer only — the candidate never receives them) and
 * private notes. Once the call has ended, the same page is its record: when it ran, the chat, the notes.
 * Notes cannot be edited or deleted, and only administrators ever see them.
 */
export function AdminCallPage() {
  const { interviewId = '', callId = '' } = useParams()
  const navigate = useNavigate()
  const api = useApi()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const path = `/api/v1/interviews/${interviewId}/calls/${callId}`

  const reload = useCallback(
    () =>
      api<AdminCall>(path)
        .then((call) => setLoad({ status: 'ready', call }))
        .catch((error: unknown) => setLoad({ status: 'error', message: describeError(error, 'Could not load the call.') })),
    [api, path],
  )
  useEffect(() => {
    void reload()
  }, [reload])

  const back = () => navigate(routes.admin.interviewDetail(interviewId))

  if (load.status === 'loading') return <CallMessage title="Opening the call…" />
  if (load.status === 'error') {
    return (
      <CallMessage title="Could not open the call">
        <p className="text-[13px] text-gray-400">{load.message}</p>
        <Button variant="secondary" onClick={back}>
          Back to the interview
        </Button>
      </CallMessage>
    )
  }
  const onNote = (notes: CallNote[]) => setLoad({ status: 'ready', call: { ...load.call, notes } })
  if (load.call.status === 'ENDED') return <CallRecord call={load.call} onBack={back} onNote={onNote} />
  return <LiveInterviewerCall record={load.call} onEnded={() => void reload()} onBack={back} onNote={onNote} />
}

function LiveInterviewerCall({
  record,
  onEnded,
  onBack,
  onNote,
}: {
  record: AdminCall
  onEnded(): void
  onBack(): void
  onNote(notes: CallNote[]): void
}) {
  const api = useApi()
  const call = useCall(record.call_id, 'interviewer', record.messages, true)
  const [tab, setTab] = useState<'chat' | 'guide' | 'notes'>('guide')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (call.phase === 'ended' || call.phase === 'unavailable') onEnded()
  }, [call.phase, onEnded])

  if (call.phase === 'occupied') {
    return (
      <CallMessage title="Another interviewer is already in this call">
        <p className="text-[13px] text-gray-400">A call is one-to-one. You can follow it from its record once it ends.</p>
        <Button variant="secondary" onClick={onBack}>
          Back to the interview
        </Button>
      </CallMessage>
    )
  }

  const end = async () => {
    setEnding(true)
    setError(null)
    try {
      await api(`/api/v1/interviews/${record.interview_id}/calls/${record.call_id}/end`, { method: 'POST' })
      setConfirmEnd(false)
      onEnded()
    } catch (err) {
      setError(describeError(err, 'Could not end the call.'))
    } finally {
      setEnding(false)
    }
  }

  const tabs = [
    ['guide', 'Guide'],
    ['notes', `Notes${record.notes.length ? ` (${record.notes.length})` : ''}`],
    ['chat', `Chat${call.messages.length ? ` (${call.messages.length})` : ''}`],
  ] as const

  return (
    <>
      <CallScreen
        call={call}
        role="interviewer"
        title={record.interview_title}
        subtitle={`Live interview with ${record.candidate_name}${record.candidate_roll_number ? ` · ${record.candidate_roll_number}` : ''}`}
        openedAt={record.opened_at}
        plannedMinutes={record.planned_minutes}
        peerName={record.candidate_name}
        endControl={
          <Button variant="danger" onClick={() => setConfirmEnd(true)}>
            End call
          </Button>
        }
        panel={
          <>
            <div className="flex border-b border-gray-800" role="tablist" aria-label="Interviewer panel">
              {tabs.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={cn('flex-1 py-2.5 text-[13px] font-medium', tab === key ? 'border-b-2 border-blue-500 text-white' : 'text-gray-400 hover:text-white')}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'chat' && <ChatPanel messages={call.messages} role="interviewer" onSend={call.sendChat} disabled={call.phase === 'reconnecting' || call.phase === 'connecting'} />}
            {tab === 'guide' && <QuestionGuide interviewId={record.interview_id} />}
            {tab === 'notes' && <NotesPanel call={record} onNote={onNote} dark />}
          </>
        }
      />
      <ConfirmDialog
        open={confirmEnd}
        title="End this call?"
        description={error ?? 'Video stops for both of you. The chat and your notes are kept with the call record.'}
        confirmLabel="End call"
        confirmVariant="danger"
        busy={ending}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => void end()}
      />
    </>
  )
}

/** The question bank as the interviewer's guide. Admin-only data (expected concepts). */
function QuestionGuide({ interviewId }: { interviewId: string }) {
  const { state } = useInterview(interviewId)
  if (state.status === 'loading') return <p className="p-3 text-[13px] text-gray-400">Loading questions…</p>
  if (state.status === 'error') return <p className="p-3 text-[13px] text-amber-300">{state.message}</p>
  const ordered = orderQuestions(state.data.questions.filter((q) => q.is_active))
  if (ordered.length === 0) return <p className="p-3 text-[13px] text-gray-400">This interview has no questions. Ask your own.</p>
  return (
    <ol className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-[13px]" aria-label="Question guide">
      {ordered.map(({ primary, followUp }, index) => (
        <li key={primary.id} className="rounded-md bg-gray-900 p-2.5">
          <p className="text-[11.5px] text-gray-400">
            Q{index + 1} · {primary.topic} · {DIFFICULTIES[primary.difficulty]}
          </p>
          <p className="mt-0.5 text-gray-100">{primary.text}</p>
          {primary.expected_concepts.length > 0 && (
            <p className="mt-1 text-[12px] text-gray-400">Listen for: {primary.expected_concepts.join(', ')}</p>
          )}
          {followUp && <p className="mt-1.5 border-l-2 border-gray-700 pl-2 text-[12.5px] text-gray-300">Follow-up: {followUp.text}</p>}
        </li>
      ))}
    </ol>
  )
}

/** Private, append-only interviewer notes. */
function NotesPanel({ call, onNote, dark }: { call: AdminCall; onNote(notes: CallNote[]): void; dark?: boolean }) {
  const api = useApi()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const body = text.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api<AdminCall>(`/api/v1/interviews/${call.interview_id}/calls/${call.call_id}/notes`, { method: 'POST', body: { body } })
      onNote(updated.notes)
      setText('')
    } catch (err) {
      setError(describeError(err, 'Could not save the note.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-label="Interviewer notes">
        {call.notes.length === 0 && <li className={cn('text-[12.5px]', dark ? 'text-gray-400' : 'text-ink-subtle')}>No notes yet.</li>}
        {call.notes.map((n) => (
          <li key={n.note_id} className={cn('rounded-md p-2.5 text-[13px]', dark ? 'bg-gray-900 text-gray-100' : 'bg-surface text-ink')}>
            <p className={cn('text-[11.5px]', dark ? 'text-gray-400' : 'text-ink-subtle')}>
              {n.author.name} · {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="whitespace-pre-wrap">{n.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={save} className={cn('space-y-2 border-t p-3', dark ? 'border-gray-800' : 'border-line')}>
        <textarea
          aria-label="New note"
          rows={3}
          maxLength={MAX_NOTE}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Private to administrators. Notes cannot be edited or deleted."
          className={cn(
            'w-full rounded-md border px-2 py-1.5 text-[13px] focus:outline-none',
            dark ? 'border-gray-700 bg-gray-900 text-white placeholder:text-gray-500 focus:border-blue-500' : 'border-line-strong bg-card text-ink focus:border-accent',
          )}
        />
        {error && (
          <p className="text-[12px] text-red-400" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="sm" disabled={!text.trim()} loading={busy}>
          Save note
        </Button>
      </form>
    </div>
  )
}

/** An ended call: when it ran, its chat and the notes (more can still be added). */
function CallRecord({ call, onBack, onNote }: { call: AdminCall; onBack(): void; onNote(notes: CallNote[]): void }) {
  const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')
  return (
    <div className="bg-surface h-full w-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-ink text-[18px] font-semibold">Call record — {call.candidate_name}</h1>
            <p className="text-ink-subtle text-[13px]">{call.interview_title} · nothing was recorded; this is the call’s log.</p>
          </div>
          <Button variant="secondary" onClick={onBack}>
            Back to the interview
          </Button>
        </div>
        <dl className="bg-card border-line grid grid-cols-2 gap-3 rounded-lg border p-4 text-[13px] sm:grid-cols-4" aria-label="Call details">
          <div>
            <dt className="text-ink-subtle">Opened</dt>
            <dd className="text-ink">
              {at(call.opened_at)} by {call.opened_by.name}
            </dd>
          </div>
          <div>
            <dt className="text-ink-subtle">Candidate joined</dt>
            <dd className="text-ink">{at(call.candidate_joined_at)}</dd>
          </div>
          <div>
            <dt className="text-ink-subtle">Ended</dt>
            <dd className="text-ink">
              {at(call.ended_at)}
              {call.ended_by ? ` by ${call.ended_by.name}` : ''}
            </dd>
          </div>
          <div>
            <dt className="text-ink-subtle">Duration</dt>
            <dd className="text-ink" data-testid="call-duration">
              {formatElapsed(call.duration_seconds)}
            </dd>
          </div>
        </dl>
        <div className="grid gap-4 md:grid-cols-2">
          <section className="bg-card border-line flex h-[28rem] flex-col rounded-lg border" aria-label="Chat transcript">
            <h2 className="text-ink border-line border-b px-3 py-2 text-[13.5px] font-semibold">Chat</h2>
            <div className="flex min-h-0 flex-1 flex-col bg-gray-950">
              <ChatPanel messages={call.messages} role="interviewer" />
            </div>
          </section>
          <section className="bg-card border-line flex h-[28rem] flex-col rounded-lg border" aria-label="Notes">
            <h2 className="text-ink border-line border-b px-3 py-2 text-[13.5px] font-semibold">Interviewer notes</h2>
            <NotesPanel call={call} onNote={onNote} />
          </section>
        </div>
      </div>
    </div>
  )
}
