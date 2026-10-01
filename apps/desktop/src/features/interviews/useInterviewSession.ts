import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@/features/session'
import { ApiError } from '@/lib/api'
import { describeError } from './useInterviews'
import type { SessionState } from './types'

const ME = '/api/v1/candidates/me'
/** The countdown redraws this often. Display only. */
const TICK_MS = 1_000
/** The state is re-read from the server this often (and on window focus). */
const RESYNC_MS = 30_000
/** Once the local countdown reaches zero, ask the server this often until it confirms the end. */
const EXPIRY_RESYNC_MS = 1_500
/** While an answer is being processed (Phase 7B), ask the server this often for the next question. */
const PROCESSING_POLL_MS = 1_500

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; session: SessionState }

/**
 * The candidate's interview session, as the server holds it (Phase 7A).
 *
 * Opening the runner starts the interview or resumes it (`POST …/session` is idempotent), so a
 * refresh, a reconnect or reopening the app lands on the same question. The countdown measures this
 * machine's clock offset from `server_time` and counts down to the server's `expires_at`; reaching
 * zero locally only prompts a re-read — the server decides when the interview has ended.
 *
 * `submit` sends only the answer and the item it answers. If the server says the item is no longer
 * current (a double submit, a second window) or the interview has ended, the state is re-read and the
 * candidate is told — the typed text is kept, never silently dropped.
 */
export function useInterviewSession(interviewId: string) {
  const api = useApi()
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [online, setOnline] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Server time minus local time, in milliseconds — measured on every response.
  const [offsetMs, setOffsetMs] = useState(0)
  const sessionId = load.status === 'ready' ? load.session.session_id : null

  const accept = useCallback((session: SessionState) => {
    setOffsetMs(Date.parse(session.server_time) - Date.now())
    setOnline(true)
    setLoad({ status: 'ready', session })
  }, [])

  // Start or resume once.
  useEffect(() => {
    let cancelled = false
    api<SessionState>(`${ME}/interviews/${interviewId}/session`, { method: 'POST' })
      .then((session) => {
        if (!cancelled) accept(session)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: describeError(error, 'Could not open the interview.') })
      })
    return () => {
      cancelled = true
    }
  }, [api, interviewId, accept])

  const resync = useCallback(async () => {
    if (!sessionId) return
    try {
      accept(await api<SessionState>(`${ME}/interview-sessions/${sessionId}`))
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'network') setOnline(false)
    }
  }, [api, sessionId, accept])

  const active = load.status === 'ready' && load.session.status === 'ACTIVE'
  const expiresAt = load.status === 'ready' ? Date.parse(load.session.expires_at) : 0
  const remaining = active ? Math.max(0, Math.floor((expiresAt - (now + offsetMs)) / 1000)) : 0

  useEffect(() => {
    if (!active) return
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS)
    const sync = window.setInterval(() => void resync(), RESYNC_MS)
    const onFocus = () => void resync()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(tick)
      window.clearInterval(sync)
      window.removeEventListener('focus', onFocus)
    }
  }, [active, resync])

  // While the last answer is processed, poll for the next question (the server decides when it is ready).
  const processing = load.status === 'ready' && load.session.processing
  useEffect(() => {
    if (!processing) return
    const timer = window.setInterval(() => void resync(), PROCESSING_POLL_MS)
    return () => window.clearInterval(timer)
  }, [processing, resync])

  // At zero, ask the server — it decides whether the interview has ended.
  useEffect(() => {
    if (!active || remaining > 0) return
    const timer = window.setInterval(() => void resync(), EXPIRY_RESYNC_MS)
    return () => window.clearInterval(timer)
  }, [active, remaining, resync])

  const submit = useCallback(
    async (text: string): Promise<boolean> => {
      if (load.status !== 'ready' || !load.session.current) return false
      setBusy(true)
      setNotice(null)
      try {
        accept(
          await api<SessionState>(`${ME}/interview-sessions/${load.session.session_id}/answers`, {
            method: 'POST',
            body: { item_id: load.session.current.item_id, answer_text: text },
          }),
        )
        return true
      } catch (error) {
        if (error instanceof ApiError && (error.code === 'stale_question' || error.code === 'interview_completed')) {
          setNotice(
            error.code === 'interview_completed'
              ? 'The interview has ended, so this answer was not saved.'
              : 'This question was already answered (perhaps in another window). The interview has been reloaded.',
          )
          await resync()
        } else {
          if (error instanceof ApiError && error.kind === 'network') setOnline(false)
          setNotice(`Your answer was not saved: ${describeError(error, 'please try again.')} Your text is still here.`)
        }
        return false
      } finally {
        setBusy(false)
      }
    },
    [api, load, accept, resync],
  )

  const end = useCallback(async () => {
    if (!sessionId) return
    setBusy(true)
    try {
      accept(await api<SessionState>(`${ME}/interview-sessions/${sessionId}/complete`, { method: 'POST' }))
    } catch (error) {
      setNotice(describeError(error, 'Could not end the interview. Try again.'))
    } finally {
      setBusy(false)
    }
  }, [api, sessionId, accept])

  return { load, online, busy, notice, remaining, submit, end, resync }
}

/** A draft answer kept per question in this browser only, so a refresh does not lose typing. */
export const drafts = {
  key: (itemId: string) => `assessx.interview-draft.${itemId}`,
  read(itemId: string): string {
    try {
      return localStorage.getItem(drafts.key(itemId)) ?? ''
    } catch {
      return ''
    }
  },
  write(itemId: string, text: string) {
    try {
      if (text) localStorage.setItem(drafts.key(itemId), text)
      else localStorage.removeItem(drafts.key(itemId))
    } catch {
      /* storage unavailable: the draft lives in memory only */
    }
  },
}
