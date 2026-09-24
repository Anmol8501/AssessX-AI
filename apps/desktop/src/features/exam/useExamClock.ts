import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/lib/api'
import { useApi } from '@/features/session'
import type { AttemptDetail, AttemptSession, AttemptStatus } from './types'
import { TERMINAL_ATTEMPT_STATUSES } from './types'

const ME = '/api/v1/candidates/me'

/** How often the countdown redraws. Display only — it changes nothing the server enforces. */
const TICK_MS = 1_000
/** How often the clock is checked against the server. */
const RESYNC_MS = 30_000
/** How often to re-ask once the countdown has run out but the server has not confirmed. */
const EXPIRY_RESYNC_MS = 1_500
/** Below this, the exam is nearly over and the timer says so. */
export const WARNING_SECONDS = 5 * 60
/** Below this, it is about to end. */
export const CRITICAL_SECONDS = 60

export interface ExamClock {
  /** Seconds left, as the server would compute them right now. Never negative. */
  remaining: number
  /** The server's view of the attempt, refreshed on every resync. */
  status: AttemptStatus
  /** True once the server says the attempt is finished, however it ended. */
  finished: boolean
  /** False when the last resync could not reach the server. */
  online: boolean
  /** Forces an immediate resync — used after submitting and when the window regains focus. */
  resync: () => Promise<void>
}

/**
 * The exam countdown, anchored to the server's clock.
 *
 * The mechanism, and the reason it is not simply `setInterval` over a local deadline:
 *
 * 1. The attempt carries `expires_at` **and** `server_time`. Subtracting them gives the offset
 *    between this machine's clock and the server's, measured once.
 * 2. The countdown then displays `expires_at - (local now + offset)`. Winding the system clock
 *    forward moves `local now` and the offset by the same amount, so the displayed time does not
 *    move — and would not matter if it did, because the server re-checks the deadline on every
 *    request it serves.
 * 3. A periodic resync replaces the offset with a fresh measurement and, crucially, re-reads the
 *    status: it is the server that decides the attempt has expired, and this is how the exam
 *    screen finds out while the candidate is sitting on it.
 *
 * Reaching zero locally is therefore a prompt to ask the server, not a verdict. `finished` only
 * ever becomes true because a response said so.
 */
export function useExamClock(attempt: AttemptDetail): ExamClock {
  const api = useApi()
  // Server time minus local time, in milliseconds.
  const [offsetMs, setOffsetMs] = useState(() => Date.parse(attempt.server_time) - Date.now())
  const [status, setStatus] = useState<AttemptStatus>(attempt.status)
  const [online, setOnline] = useState(true)
  const [ticking, setTicking] = useState(attempt.remaining_seconds)

  const expiresAt = Date.parse(attempt.expires_at)
  const finished = TERMINAL_ATTEMPT_STATUSES.has(status)
  // Derived, not stored: a finished attempt has no time left by definition, so there is nothing
  // to keep in sync.
  const remaining = finished ? 0 : ticking

  const finishedRef = useRef(finished)
  useEffect(() => {
    finishedRef.current = finished
  }, [finished])

  const resync = useCallback(async () => {
    try {
      const session = await api<AttemptSession>(`${ME}/attempts/${attempt.id}/session`)
      setOffsetMs(Date.parse(session.server_time) - Date.now())
      setStatus(session.status)
      setTicking(session.remaining_seconds)
      setOnline(true)
    } catch (error) {
      // A lost connection is reported, not hidden. The countdown keeps running from the last
      // known offset; the server will still refuse anything sent after the deadline.
      if (error instanceof ApiError) setOnline(false)
    }
  }, [api, attempt.id])

  // Local tick: presentation only.
  useEffect(() => {
    if (finished) return
    const id = setInterval(() => {
      setTicking(Math.max(0, Math.floor((expiresAt - (Date.now() + offsetMs)) / 1000)))
    }, TICK_MS)
    return () => clearInterval(id)
  }, [expiresAt, offsetMs, finished])

  // Periodic resync, plus one the moment the countdown believes it has run out — that is when the
  // server's answer matters most, and it is the server that ends the attempt.
  useEffect(() => {
    if (finished) return
    const id = setInterval(() => void resync(), RESYNC_MS)
    return () => clearInterval(id)
  }, [resync, finished])

  // The countdown has reached zero but the server has not confirmed the end yet — because of
  // clock skew, a slow request, or a dropped connection. Ask more often until it does, rather
  // than once (which could leave the screen stuck) or every tick (which would be a request
  // storm). `outOfTime` is a boolean, so this effect runs when it flips, not on each second, and
  // a countdown reading 00:00 while the confirmation lands is honest in the meantime.
  const outOfTime = !finished && remaining <= 0
  useEffect(() => {
    if (!outOfTime) return
    const id = setInterval(() => void resync(), EXPIRY_RESYNC_MS)
    return () => clearInterval(id)
  }, [outOfTime, resync])

  // A machine that was asleep, or a window that was in the background, has a stale countdown.
  useEffect(() => {
    function check() {
      if (!finishedRef.current && document.visibilityState === 'visible') void resync()
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
    }
  }, [resync])

  return { remaining, status, finished, online, resync }
}

/** `mm:ss`, or `h:mm:ss` for an exam longer than an hour. */
export function formatRemaining(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`
}
