import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@/features/session'
import { ApiError } from '@/lib/api'
import { toReview, type AttemptReview, type EvidenceMark, type ReviewOutcome } from './types'

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; review: AttemptReview }

/**
 * One attempt's human review (`/api/v1/admin/attempts/{id}/review`).
 *
 * Every write returns the whole review, which replaces local state. A 409 `review_conflict` means
 * another administrator changed the review first: the hook re-reads it and reports who decided, so
 * nothing is overwritten and nothing is retried blindly. The client never sends an identity or a
 * time — only the outcome, the text and the version it was looking at.
 */
export function useReview(attemptId: string) {
  const api = useApi()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const base = `/api/v1/admin/attempts/${attemptId}/review`

  const load = useCallback(
    () =>
      api<Record<string, unknown>>(base)
        .then((raw) => setState({ status: 'ready', review: toReview(raw) }))
        .catch((caught: unknown) =>
          setState({ status: 'error', message: caught instanceof Error ? caught.message : 'The review is unavailable.' }),
        ),
    [api, base],
  )

  useEffect(() => {
    void load()
  }, [load])

  const write = useCallback(
    async (path: string, method: 'POST' | 'PUT', body?: unknown): Promise<boolean> => {
      setBusy(true)
      setNotice(null)
      try {
        const raw = await api<Record<string, unknown>>(`${base}${path}`, { method, body })
        setState({ status: 'ready', review: toReview(raw) })
        return true
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'review_conflict') {
          const details = (caught.details ?? {}) as Record<string, unknown>
          const who = typeof details.completed_by === 'string' ? ` by ${details.completed_by}` : ''
          setNotice(`This review was changed${who} while you were working. It has been reloaded — check it before deciding.`)
          await load()
        } else {
          setNotice(caught instanceof Error ? caught.message : 'That did not work. Try again.')
        }
        return false
      } finally {
        setBusy(false)
      }
    },
    [api, base, load],
  )

  const version = state.status === 'ready' ? state.review.version : null

  return {
    state,
    busy,
    notice,
    reload: load,
    start: () => write('', 'POST'),
    addNote: (body: string) => write('/notes', 'POST', { body }),
    mark: (evidenceId: string, mark: EvidenceMark) => write(`/marks/${evidenceId}`, 'PUT', { mark }),
    complete: (outcome: ReviewOutcome, rationale: string) =>
      write('/complete', 'POST', { outcome, rationale, expected_version: version }),
    revise: (outcome: ReviewOutcome, rationale: string) =>
      write('/revise', 'POST', { outcome, rationale, expected_version: version }),
  }
}
