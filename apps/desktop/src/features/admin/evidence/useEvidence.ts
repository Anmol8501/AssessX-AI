import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '@/features/session'
import { mergePages, toPage, toSourceEvents, type EvidencePage, type SourceEvent } from './types'

const PAGE_SIZE = 50
/** A live attempt's first page is re-fetched at most this often when new events arrive. */
const MIN_REFRESH_MS = 5000

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; pages: EvidencePage[] }

/**
 * One attempt's evidence timeline, a bounded page at a time (`GET …/evidence?limit&cursor`).
 *
 * `loadMore` appends the next page. For a live attempt, a changing `refreshKey` re-fetches the first
 * page (throttled) — but only while the admin has not paged further, so reading is never disturbed.
 */
export function useEvidence(attemptId: string, { refreshKey }: { refreshKey?: string | number } = {}) {
  const api = useApi()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)
  const pagesRef = useRef<EvidencePage[]>([])
  const lastFetch = useRef(0)
  const pending = useRef<number | null>(null)
  const base = `/api/v1/admin/attempts/${attemptId}/evidence`

  const loadFirst = useCallback(() => {
    lastFetch.current = Date.now()
    void api<Record<string, unknown>>(`${base}?limit=${PAGE_SIZE}`)
      .then((raw) => {
        pagesRef.current = [toPage(raw)]
        setState({ status: 'ready', pages: pagesRef.current })
      })
      .catch((caught: unknown) =>
        setState((current) =>
          current.status === 'ready'
            ? current
            : { status: 'error', message: caught instanceof Error ? caught.message : 'Evidence is unavailable.' },
        ),
      )
  }, [api, base])

  useEffect(() => {
    if (pagesRef.current.length > 1) return // the admin has paged on: do not reset what they are reading
    const wait = lastFetch.current === 0 ? 0 : Math.max(0, lastFetch.current + MIN_REFRESH_MS - Date.now())
    if (pending.current !== null) window.clearTimeout(pending.current)
    pending.current = window.setTimeout(() => {
      pending.current = null
      loadFirst()
    }, wait)
    return () => {
      if (pending.current !== null) window.clearTimeout(pending.current)
      pending.current = null
    }
  }, [loadFirst, refreshKey])

  const loadMore = useCallback(() => {
    const last = pagesRef.current.at(-1)
    if (!last?.nextCursor || loadingMore) return
    setLoadingMore(true)
    void api<Record<string, unknown>>(`${base}?limit=${PAGE_SIZE}&cursor=${encodeURIComponent(last.nextCursor)}`)
      .then((raw) => {
        pagesRef.current = [...pagesRef.current, toPage(raw)]
        setState({ status: 'ready', pages: pagesRef.current })
      })
      .catch(() => undefined)
      .finally(() => setLoadingMore(false))
  }, [api, base, loadingMore])

  const loadSources = useCallback(
    (evidenceId: string): Promise<SourceEvent[]> =>
      api<Record<string, unknown>>(`${base}/${evidenceId}`).then(toSourceEvents),
    [api, base],
  )

  const merged = state.status === 'ready' ? mergePages(state.pages) : null
  const first = state.status === 'ready' ? state.pages[0] : null
  const hasMore = state.status === 'ready' && Boolean(state.pages.at(-1)?.nextCursor)
  return { state, merged, first, hasMore, loadMore, loadingMore, loadSources }
}
