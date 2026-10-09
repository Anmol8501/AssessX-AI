import { useCallback, useEffect, useRef } from 'react'
import { useApi } from '@/features/session'
import { ApiError } from '@/lib/api'

const ME = '/api/v1/candidates/me'
/** The same event with the same details this soon after the last is one observation, not two. */
const REPEAT_WINDOW_MS = 1500
const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 30_000
const MAX_PENDING = 200

export type EventMetadata = Record<string, string | number | boolean | string[] | Record<string, string>>

export interface PendingEvent {
  client_event_id: string
  event_type: string
  metadata: EventMetadata
  client_reported_at: string
}

function storageKey(attemptId: string) {
  return `assessx.proctoring-events.${attemptId}`
}

function loadPending(attemptId: string): PendingEvent[] {
  try {
    const raw = localStorage.getItem(storageKey(attemptId))
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as PendingEvent[]).slice(-MAX_PENDING) : []
  } catch {
    return []
  }
}

function savePending(attemptId: string, pending: PendingEvent[]) {
  try {
    if (pending.length === 0) localStorage.removeItem(storageKey(attemptId))
    else localStorage.setItem(storageKey(attemptId), JSON.stringify(pending))
  } catch {
    // Storage unavailable: the queue still lives in memory for this session.
  }
}

/**
 * Sends proctoring events for one attempt to the server, safely (Phase 4B).
 *
 * * **Observations only.** An event is a type and a few small metadata fields. No clipboard text,
 *   keystrokes or answers are ever passed in, and the server refuses anything outside its list.
 * * **Repeats are folded.** The same event with the same details within 1.5 s is reported once —
 *   holding Ctrl+V is one paste attempt, not a hundred. (The server folds repeats too.)
 * * **Nothing is lost to a dropped connection.** Events queue in order, are kept in local storage
 *   until the server confirms them, and are retried with back-off. Each carries a
 *   `client_event_id`, so a retry after a lost response cannot create a duplicate.
 * * **The server's clock is the record.** `client_reported_at` travels as a hint; the server stamps
 *   `recorded_at` itself.
 * * **The server decides when to stop.** Once the attempt has ended (`attempt_locked`) or the
 *   session's ceiling is reached, the queue is discarded; an event the server rejects as invalid is
 *   dropped rather than retried forever.
 */
/** What the server answered for an event: the evidence-clip decision, when there is one (FR-017). */
export interface RecordedEvent {
  id: string
  clip_request?: { clip_id: string; upload: boolean } | null
}

export interface ReporterHooks {
  /** An event was queued (observed now, sent soon). */
  onQueued?(event: PendingEvent): void
  /** The server recorded the event (or recognised a retry) and answered with this. */
  onRecorded?(event: PendingEvent, recorded: RecordedEvent): void
}

export function useEventReporter(attemptId: string, hooks?: ReporterHooks) {
  const api = useApi()
  const hooksRef = useRef(hooks)
  useEffect(() => {
    hooksRef.current = hooks
  })
  const queue = useRef<PendingEvent[]>([])
  const lastSeen = useRef<Map<string, number>>(new Map())
  const sending = useRef(false)
  const stopped = useRef(false)
  const retryTimer = useRef<number | null>(null)
  const retryDelay = useRef(RETRY_BASE_MS)

  const persist = useCallback(() => savePending(attemptId, queue.current), [attemptId])

  const flush = useCallback(async () => {
    if (sending.current || stopped.current) return
    sending.current = true
    try {
      while (queue.current.length > 0 && !stopped.current) {
        const next = queue.current[0]
        let recorded: RecordedEvent | undefined
        try {
          recorded = await api<RecordedEvent>(`${ME}/attempts/${attemptId}/proctoring/events`, { method: 'POST', body: next })
        } catch (caught) {
          if (caught instanceof ApiError && caught.kind === 'http') {
            if (caught.code === 'attempt_locked' || caught.code === 'event_limit_reached') {
              stopped.current = true
              queue.current = []
              break
            }
            if (caught.status >= 400 && caught.status < 500 && caught.status !== 408 && caught.status !== 429) {
              queue.current.shift() // the server will never accept this one; do not retry it
              persist()
              continue
            }
          }
          // Offline, server unavailable, or rate-limited: keep it and try again later.
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null
            void flush()
          }, retryDelay.current)
          retryDelay.current = Math.min(retryDelay.current * 2, RETRY_MAX_MS)
          break
        }
        queue.current.shift()
        retryDelay.current = RETRY_BASE_MS
        persist()
        if (recorded && next) {
          try {
            hooksRef.current?.onRecorded?.(next, recorded)
          } catch {
            // Evidence handling must never stop events from flowing.
          }
        }
      }
    } finally {
      sending.current = false
      persist()
    }
  }, [api, attemptId, persist])

  // Deliver anything left over from before a restart or reload.
  useEffect(() => {
    stopped.current = false
    queue.current = [...loadPending(attemptId), ...queue.current]
    void flush()
    return () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
      retryTimer.current = null
      persist()
    }
  }, [attemptId, flush, persist])

  /** Queues an event. Returns false when it was folded into an identical recent one. */
  const report = useCallback(
    (eventType: string, metadata: EventMetadata = {}): boolean => {
      if (stopped.current) return false
      const key = `${eventType}:${JSON.stringify(metadata)}`
      const now = Date.now()
      const previous = lastSeen.current.get(key)
      lastSeen.current.set(key, now)
      if (previous !== undefined && now - previous < REPEAT_WINDOW_MS) return false

      const event: PendingEvent = {
        client_event_id: crypto.randomUUID(),
        event_type: eventType,
        metadata,
        client_reported_at: new Date().toISOString(),
      }
      queue.current.push(event)
      try {
        hooksRef.current?.onQueued?.(event)
      } catch {
        // Evidence handling must never stop events from flowing.
      }
      if (queue.current.length > MAX_PENDING) queue.current.splice(0, queue.current.length - MAX_PENDING)
      persist()
      void flush()
      return true
    },
    [flush, persist],
  )

  return report
}
