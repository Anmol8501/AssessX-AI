import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from '@/features/assessments/useAssessments'
import { ApiError, apiPage } from '@/lib/api'
import { tokenStorage } from './tokenStorage'
import { useSession } from './useSession'

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

const PAGE = 50

function withPage(path: string, limit: number, offset: number): string {
  return `${path}${path.includes('?') ? '&' : '?'}limit=${limit}&offset=${offset}`
}

/**
 * A server list read one page at a time (Phase 8 final, CX-04). The first page loads on mount; `loadMore`
 * appends the next one while `hasMore`. `reload` starts again from the top (after a create or delete).
 */
export function usePagedList<T>(path: string, failure: string) {
  const { expire } = useSession()
  const [state, setState] = useState<Loadable<T[]>>({ status: 'loading' })
  const [next, setNext] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const generation = useRef(0)

  const fetchPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      try {
        return await apiPage<T>(withPage(path, PAGE, offset), { token: tokenStorage.get(), signal })
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) expire()
        throw error
      }
    },
    [path, expire],
  )

  const reload = useCallback(
    (signal?: AbortSignal) => {
      const mine = ++generation.current
      return fetchPage(0, signal)
        .then((page) => {
          if (signal?.aborted || mine !== generation.current) return
          setState({ status: 'ready', data: page.items })
          setNext(page.nextOffset)
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) setState({ status: 'error', message: describeError(error, failure) })
        })
    },
    [fetchPage, failure],
  )

  useEffect(() => {
    const controller = new AbortController()
    void reload(controller.signal)
    return () => controller.abort()
  }, [reload])

  const loadMore = useCallback(async () => {
    if (next === null || loadingMore) return
    const mine = generation.current
    setLoadingMore(true)
    try {
      const page = await fetchPage(next)
      if (mine !== generation.current) return
      setState((current) => (current.status === 'ready' ? { status: 'ready', data: [...current.data, ...page.items] } : current))
      setNext(page.nextOffset)
    } catch {
      // The rows already shown stay; the button can be pressed again.
    } finally {
      setLoadingMore(false)
    }
  }, [next, loadingMore, fetchPage])

  return { state, reload, hasMore: next !== null, loadMore, loadingMore }
}

/**
 * Every row of a list, for a picker that must offer all of them (e.g. candidates to assign): fetched in
 * bounded pages of 200, up to `ceiling` rows.
 */
export async function fetchAllPages<T>(path: string, ceiling = 2000): Promise<T[]> {
  const rows: T[] = []
  let offset: number | null = 0
  while (offset !== null && rows.length < ceiling) {
    const page: { items: T[]; nextOffset: number | null } = await apiPage<T>(withPage(path, 200, offset), { token: tokenStorage.get() })
    rows.push(...page.items)
    offset = page.nextOffset
  }
  return rows.slice(0, ceiling)
}
