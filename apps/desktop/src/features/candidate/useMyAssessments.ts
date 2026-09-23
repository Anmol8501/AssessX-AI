import { useCallback, useEffect, useState } from 'react'
import { describeError } from '@/features/assessments/useAssessments'
import type { MyAssessment } from '@/features/assessments/types'
import { useApi } from '@/features/session'

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

/**
 * The assessments assigned to the signed-in candidate. The server scopes this to the
 * session's own user, and never returns questions or answer keys.
 */
export function useMyAssessments() {
  const api = useApi()
  const [state, setState] = useState<Loadable<MyAssessment[]>>({ status: 'loading' })

  const load = useCallback(
    (signal?: AbortSignal) =>
      api<MyAssessment[]>('/api/v1/candidates/me/assessments', { signal })
        .then((data) => {
          if (!signal?.aborted) setState({ status: 'ready', data })
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) setState({ status: 'error', message: describeError(error, 'Could not load your exams.') })
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
