import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@/features/session'
import { toQueue, type QueueItem, type ReviewQueue, type ReviewStatus } from './types'

export interface QueueFilters {
  status: ReviewStatus | null
  assessmentId: string | null
  /** `YYYY-MM-DD`, local dates; sent as the start of each day. */
  finishedFrom: string | null
  finishedTo: string | null
}

const PAGE_SIZE = 20

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; queue: ReviewQueue }

function query(filters: QueueFilters, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (filters.status) params.set('review_status', filters.status)
  if (filters.assessmentId) params.set('assessment_id', filters.assessmentId)
  if (filters.finishedFrom) params.set('finished_from', new Date(`${filters.finishedFrom}T00:00:00`).toISOString())
  if (filters.finishedTo) {
    const end = new Date(`${filters.finishedTo}T00:00:00`)
    end.setDate(end.getDate() + 1) // inclusive of the chosen day
    params.set('finished_to', end.toISOString())
  }
  if (cursor) params.set('cursor', cursor)
  return params.toString()
}

/** The review queue (`GET /api/v1/admin/attempts`), a bounded page at a time. */
export function useReviewQueue(filters: QueueFilters) {
  const api = useApi()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)

  // The previous page stays on screen until the new one arrives (no flash of "loading" per filter).
  const load = useCallback(() => {
    void api<Record<string, unknown>>(`/api/v1/admin/attempts?${query(filters, null)}`)
      .then((raw) => setState({ status: 'ready', queue: toQueue(raw) }))
      .catch((caught: unknown) =>
        setState({ status: 'error', message: caught instanceof Error ? caught.message : 'The queue is unavailable.' }),
      )
  }, [api, filters])

  useEffect(load, [load])

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || !state.queue.nextCursor || loadingMore) return
    setLoadingMore(true)
    const current = state.queue
    void api<Record<string, unknown>>(`/api/v1/admin/attempts?${query(filters, current.nextCursor)}`)
      .then((raw) => {
        const next = toQueue(raw)
        const items: QueueItem[] = [...current.items, ...next.items]
        setState({ status: 'ready', queue: { ...next, items } })
      })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false))
  }, [api, filters, loadingMore, state])

  return { state, reload: load, loadMore, loadingMore }
}
