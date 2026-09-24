import { useCallback, useEffect, useState } from 'react'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi } from '@/features/session'
import type { AssessmentResults, CandidateResult, ResultSummary } from './types'

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

const ME = '/api/v1/candidates/me'

/** Formats a percentage the server sent as an exact decimal string, e.g. `87.50` → `87.5%`. */
export function formatPercentage(percentage: string | null): string {
  if (percentage === null) return '—'
  const value = Number(percentage)
  if (Number.isNaN(value)) return percentage
  // Trailing zeros dropped for reading, but nothing is re-rounded: 87.50 is shown as 87.5, and
  // 33.33 stays 33.33.
  return `${String(Number(value.toFixed(2)))}%`
}

/** The candidate's own result for one finished attempt. */
export function useAttemptResult(attemptId: string | null) {
  const api = useApi()
  const [state, setState] = useState<Loadable<CandidateResult>>({ status: 'loading' })

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!attemptId) return Promise.resolve()
      return api<CandidateResult>(`${ME}/attempts/${attemptId}/result`, { signal })
        .then((data) => {
          if (!signal?.aborted) setState({ status: 'ready', data })
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) {
            setState({ status: 'error', message: describeError(error, 'Could not load your result.') })
          }
        })
    },
    [api, attemptId],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { state, reload: load }
}

/** Every result the candidate is allowed to see. */
export function useMyResults() {
  const api = useApi()
  const [state, setState] = useState<Loadable<ResultSummary[]>>({ status: 'loading' })

  const load = useCallback(
    (signal?: AbortSignal) =>
      api<ResultSummary[]>(`${ME}/results`, { signal })
        .then((data) => {
          if (!signal?.aborted) setState({ status: 'ready', data })
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) {
            setState({ status: 'error', message: describeError(error, 'Could not load your results.') })
          }
        }),
    [api],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { state, reload: load }
}

/** Every candidate's result for one assessment. Admin-only; the server enforces that. */
export function useAssessmentResults(assessmentId: string) {
  const api = useApi()
  const [state, setState] = useState<Loadable<AssessmentResults>>({ status: 'loading' })

  const load = useCallback(
    (signal?: AbortSignal) =>
      api<AssessmentResults>(`/api/v1/assessments/${assessmentId}/results`, { signal })
        .then((data) => {
          if (!signal?.aborted) setState({ status: 'ready', data })
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) {
            setState({ status: 'error', message: describeError(error, 'Could not load these results.') })
          }
        }),
    [api, assessmentId],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { state, reload: load }
}
