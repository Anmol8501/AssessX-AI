import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '@/features/session'
import { toRisk, type AttemptRisk } from './types'

/** A live attempt's risk is re-fetched at most this often when new events arrive… */
const MIN_REFRESH_MS = 5000
/** …and on this interval regardless, because contributions decay over time. */
const LIVE_INTERVAL_MS = 30_000

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; risk: AttemptRisk }

/**
 * One attempt's server-computed risk (`GET /api/v1/admin/attempts/{id}/risk`).
 *
 * For a live attempt, pass a `refreshKey` that changes when new events arrive (e.g. the newest
 * event id): the risk is re-fetched, throttled to once per `MIN_REFRESH_MS`, and also every
 * `LIVE_INTERVAL_MS`. A finished attempt's risk never changes, so it is fetched once.
 */
export function useAttemptRisk(attemptId: string, { live, refreshKey }: { live: boolean; refreshKey?: string | number }) {
  const api = useApi()
  const [state, setState] = useState<State>({ status: 'loading' })
  const lastFetch = useRef(0)
  const pending = useRef<number | null>(null)

  const load = useCallback(() => {
    lastFetch.current = Date.now()
    void api<Record<string, unknown>>(`/api/v1/admin/attempts/${attemptId}/risk`)
      .then((raw) => setState({ status: 'ready', risk: toRisk(raw) }))
      .catch((caught: unknown) =>
        setState((current) =>
          current.status === 'ready'
            ? current // keep showing the last good state on a transient failure
            : { status: 'error', message: caught instanceof Error ? caught.message : 'Risk is unavailable.' },
        ),
      )
  }, [api, attemptId])

  // Initial load, and a throttled refresh whenever new events arrive.
  useEffect(() => {
    const wait = Math.max(0, lastFetch.current + MIN_REFRESH_MS - Date.now())
    if (pending.current !== null) window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      pending.current = null
      load()
    }, lastFetch.current === 0 ? 0 : wait)
    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current)
      pending.current = null
    }
  }, [load, refreshKey])

  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(load, LIVE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [live, load])

  return { state, reload: load }
}
