import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi } from '@/features/session'

/** The longest message the server accepts (`attempt_messages`). */
const MAX = 300
/** While open, how often the list re-reads whether the candidate has seen a message. */
const REFRESH_MS = 8000

/** Starting points for a message; the proctor can edit any of them before sending. */
const PRESETS = [
  'Please keep your head and upper body in view of the camera.',
  'Please put your phone away.',
  'Please keep your eyes on your own screen.',
  'Only you may be in the room during the exam.',
]

interface SentMessage {
  id: string
  body: string
  sent_at: string
  sent_by: { id: string; name: string } | null
  acknowledged_at: string | null
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/**
 * A short message to the candidate during a running exam — for something the proctor saw on camera
 * that the AI did not flag. It appears on the candidate's screen until they press "I understand"; the
 * list shows when each was seen. Messages are kept with the attempt for review and are never a verdict.
 */
export function ProctorMessages({ attemptId, running }: { attemptId: string; running: boolean }) {
  const api = useApi()
  const [sent, setSent] = useState<SentMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const control = await api<{ sent_messages: SentMessage[] }>(`/api/v1/admin/attempts/${attemptId}/control`)
      setSent(control.sent_messages)
    } catch {
      // The next refresh tries again.
    }
  }, [api, attemptId])

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0)
    const timer = running ? window.setInterval(() => void load(), REFRESH_MS) : null
    return () => {
      window.clearTimeout(first)
      if (timer !== null) window.clearInterval(timer)
    }
  }, [load, running])

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      const control = await api<{ sent_messages: SentMessage[] }>(`/api/v1/admin/attempts/${attemptId}/messages`, {
        method: 'POST',
        body: { body },
      })
      setSent(control.sent_messages)
      setDraft('')
    } catch (err) {
      setError(describeError(err, 'Could not send the message.'))
    } finally {
      setBusy(false)
    }
  }

  if (!running && sent.length === 0) return null
  return (
    <div className="border-line mt-3 border-t pt-3" aria-label="Message the candidate">
      <p className="text-ink text-[13px] font-semibold">Message the candidate</p>
      {running && (
        <>
          <p className="text-ink-muted mt-0.5 text-[12.5px]">Shown on their exam screen until they confirm they have read it.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setDraft(preset)}
                className="border-line-strong text-ink-muted hover:text-ink rounded-full border px-2.5 py-1 text-[12px]"
              >
                {preset}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor={`message-${attemptId}`}>
            Message
          </label>
          <textarea
            id={`message-${attemptId}`}
            rows={2}
            maxLength={MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="A short, factual message, e.g. “Please put your phone away.”"
            className="border-line-strong bg-card text-ink focus:border-accent mt-2 w-full rounded-md border px-2 py-1.5 text-[13px] focus:outline-none"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="text-ink-subtle text-[12px] tabular-nums">
              {draft.length}/{MAX}
            </span>
            <Button size="sm" onClick={() => void send()} loading={busy} disabled={!draft.trim()}>
              Send message
            </Button>
          </div>
        </>
      )}
      {error && (
        <p className="bg-danger-soft text-danger mt-2 rounded-md px-3 py-2 text-[12.5px]" role="alert">
          {error}
        </p>
      )}
      {sent.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="Messages sent">
          {[...sent].reverse().map((message) => (
            <li key={message.id} className="bg-surface rounded-md px-3 py-2 text-[12.5px]">
              <p className="text-ink">{message.body}</p>
              <p className="text-ink-subtle mt-1">
                {time(message.sent_at)}
                {message.sent_by ? ` · ${message.sent_by.name}` : ''} ·{' '}
                {message.acknowledged_at ? (
                  <span className="text-ok">Seen at {time(message.acknowledged_at)}</span>
                ) : (
                  <span>Not seen yet</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
