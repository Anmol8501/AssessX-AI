import { useCallback, useEffect, useMemo, useState } from 'react'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi } from '@/features/session'
import type {
  CandidateInterviewDetail,
  FollowUpInput,
  InterviewAssignment,
  InterviewDetail,
  InterviewInput,
  InterviewQuestion,
  InterviewSummary,
  MyInterview,
  QuestionInput,
} from './types'
import type { AdminCall, CallSummary } from './call/types'

export { describeError }

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

/** Fetches `path` once (and on `reload`); state changes only when the request settles. */
function useLoad<T>(path: string | null, fallback: string) {
  const api = useApi()
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' })
  const load = useCallback(
    (signal?: AbortSignal) =>
      path
        ? api<T>(path, { signal })
            .then((data) => {
              if (!signal?.aborted) setState({ status: 'ready', data })
            })
            .catch((error: unknown) => {
              if (!signal?.aborted) setState({ status: 'error', message: describeError(error, fallback) })
            })
        : Promise.resolve(),
    [api, path, fallback],
  )
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])
  return { state, reload: load }
}

// -- admin ------------------------------------------------------------------------------------------

export const useInterviewList = () => useLoad<InterviewSummary[]>('/api/v1/interviews', 'Could not load interviews.')

export const useInterview = (id: string | undefined) =>
  useLoad<InterviewDetail>(id ? `/api/v1/interviews/${id}` : null, 'Could not load the interview.')

/** Every admin write. Each resolves with the server's response; callers reload what they show. */
export function useInterviewActions() {
  const api = useApi()
  return useMemo(() => {
    const base = '/api/v1/interviews'
    return {
      create: (input: InterviewInput) => api<InterviewDetail>(base, { method: 'POST', body: input }),
      update: (id: string, patch: Partial<InterviewInput>) =>
        api<InterviewDetail>(`${base}/${id}`, { method: 'PATCH', body: patch }),
      remove: (id: string) => api<void>(`${base}/${id}`, { method: 'DELETE' }),
      publish: (id: string) => api<InterviewDetail>(`${base}/${id}/publish`, { method: 'POST' }),
      unpublish: (id: string) => api<InterviewDetail>(`${base}/${id}/unpublish`, { method: 'POST' }),
      addQuestion: (id: string, input: QuestionInput) =>
        api<InterviewQuestion>(`${base}/${id}/questions`, { method: 'POST', body: input }),
      updateQuestion: (id: string, questionId: string, patch: Partial<QuestionInput>) =>
        api<InterviewQuestion>(`${base}/${id}/questions/${questionId}`, { method: 'PATCH', body: patch }),
      removeQuestion: (id: string, questionId: string) =>
        api<void>(`${base}/${id}/questions/${questionId}`, { method: 'DELETE' }),
      addFollowUp: (id: string, questionId: string, input: FollowUpInput) =>
        api<InterviewQuestion>(`${base}/${id}/questions/${questionId}/follow-up`, { method: 'POST', body: input }),
      reorder: (id: string, questionIds: string[]) =>
        api<InterviewQuestion[]>(`${base}/${id}/questions/reorder`, { method: 'POST', body: { question_ids: questionIds } }),
      assignments: (id: string) => api<InterviewAssignment[]>(`${base}/${id}/assignments`),
      assign: (id: string, candidateIds: string[]) =>
        api<{ assigned: string[]; already_assigned: string[] }>(`${base}/${id}/assignments`, {
          method: 'POST',
          body: { candidate_ids: candidateIds },
        }),
      unassign: (id: string, candidateId: string) =>
        api<void>(`${base}/${id}/assignments/${candidateId}`, { method: 'DELETE' }),
      /** Phase 7D: opens the live call with this candidate (or returns the one already open). */
      openCall: (id: string, candidateId: string) =>
        api<AdminCall>(`${base}/${id}/assignments/${candidateId}/call`, { method: 'POST' }),
      calls: (id: string) => api<CallSummary[]>(`${base}/${id}/calls`),
    }
  }, [api])
}

// -- candidate --------------------------------------------------------------------------------------

export const useMyInterviews = () =>
  useLoad<MyInterview[]>('/api/v1/candidates/me/interviews', 'Could not load your interviews.')

/**
 * Phase 7D: while a live interview is waiting for its interviewer, look again every `ms` so "Join live
 * call" appears once the call is opened. Reloads settle without flicker (state changes only on reply).
 */
export function useRefreshWhile(active: boolean, reload: () => Promise<unknown>, ms = 10_000) {
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => void reload(), ms)
    return () => window.clearInterval(timer)
  }, [active, reload, ms])
}

export const useMyInterview = (id: string) =>
  useLoad<CandidateInterviewDetail>(`/api/v1/candidates/me/interviews/${id}`, 'Could not load this interview.')
