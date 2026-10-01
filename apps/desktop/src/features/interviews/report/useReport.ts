import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@/features/session'
import { ApiError } from '@/lib/api'
import { describeError } from '../useInterviews'
import type { InterviewReport, ReportQueue, ReviewOutcome, ReviewStatus } from './types'

type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

/**
 * One interview session's report and its human review. Every write returns the whole report. A 409
 * `review_conflict` means another reviewer changed the review first: the report is re-read and the
 * reviewer told who decided — nothing is overwritten or retried blindly. The client sends only the
 * reviewer's own input (outcome, text, the version they saw); identity and times are the server's.
 */
export function useInterviewReport(interviewId: string, sessionId: string) {
  const api = useApi()
  const [state, setState] = useState<Load<InterviewReport>>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const base = `/api/v1/interviews/${interviewId}/sessions/${sessionId}`

  const load = useCallback(
    () =>
      api<InterviewReport>(`${base}/report`)
        .then((data) => setState({ status: 'ready', data }))
        .catch((error: unknown) => setState({ status: 'error', message: describeError(error, 'Could not load the report.') })),
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
        setState({ status: 'ready', data: await api<InterviewReport>(`${base}${path}`, { method, body }) })
        return true
      } catch (error) {
        if (error instanceof ApiError && error.code === 'review_conflict') {
          const details = (error.details ?? {}) as Record<string, unknown>
          const who = typeof details.completed_by === 'string' ? ` by ${details.completed_by}` : ''
          setNotice(`This review was changed${who} while you were working. It has been reloaded — check it before deciding.`)
          await load()
        } else {
          setNotice(describeError(error, 'That did not work. Try again.'))
        }
        return false
      } finally {
        setBusy(false)
      }
    },
    [api, base, load],
  )

  const version = state.status === 'ready' ? state.data.review.version : null
  return {
    state,
    busy,
    notice,
    reload: load,
    start: () => write('/review', 'POST'),
    addNote: (body: string) => write('/review/notes', 'POST', { body }),
    mark: (itemId: string, mark: 'AGREE' | 'DISAGREE') => write(`/review/marks/${itemId}`, 'PUT', { mark }),
    complete: (outcome: ReviewOutcome, rationale: string) =>
      write('/review/complete', 'POST', { outcome, rationale, expected_version: version }),
    revise: (outcome: ReviewOutcome, rationale: string) =>
      write('/review/revise', 'POST', { outcome, rationale, expected_version: version }),
  }
}

export interface ReportFilters {
  reviewStatus: ReviewStatus | null
  sessionStatus: 'ACTIVE' | 'COMPLETED' | null
  evaluationState: 'NONE' | 'PENDING' | 'PARTIAL' | 'COMPLETE' | null
  interviewId: string | null
}

/** The reports queue (`GET /api/v1/interviews/reports`), newest first, a bounded page at a time. */
export function useReportQueue(filters: ReportFilters) {
  const api = useApi()
  const [state, setState] = useState<Load<ReportQueue>>({ status: 'loading' })
  const [loadingMore, setLoadingMore] = useState(false)

  const query = useCallback(
    (cursor: string | null) => {
      const params = new URLSearchParams({ limit: '20' })
      if (filters.reviewStatus) params.set('review_status', filters.reviewStatus)
      if (filters.sessionStatus) params.set('session_status', filters.sessionStatus)
      if (filters.evaluationState) params.set('evaluation_state', filters.evaluationState)
      if (filters.interviewId) params.set('interview_id', filters.interviewId)
      if (cursor) params.set('cursor', cursor)
      return `/api/v1/interviews/reports?${params.toString()}`
    },
    [filters],
  )

  const load = useCallback(() => {
    void api<ReportQueue>(query(null))
      .then((data) => setState({ status: 'ready', data }))
      .catch((error: unknown) => setState({ status: 'error', message: describeError(error, 'Could not load the reports.') }))
  }, [api, query])

  useEffect(load, [load])

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || !state.data.next_cursor || loadingMore) return
    setLoadingMore(true)
    const current = state.data
    void api<ReportQueue>(query(current.next_cursor))
      .then((next) => setState({ status: 'ready', data: { ...next, items: [...current.items, ...next.items] } }))
      .catch(() => undefined)
      .finally(() => setLoadingMore(false))
  }, [api, query, loadingMore, state])

  return { state, reload: load, loadMore, loadingMore }
}
