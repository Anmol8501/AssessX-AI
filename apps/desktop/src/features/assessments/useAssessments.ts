import { useCallback, useEffect, useState } from 'react'
import { useApi } from '@/features/session'
import { ApiError } from '@/lib/api'
import type {
  AssessmentDetail,
  AssessmentInput,
  AssessmentPatch,
  AssessmentSummary,
  Assignment,
  AssignmentResult,
  CandidateInput,
  CandidateSummary,
  Question,
  QuestionInput,
} from './types'

/** Message for a failed request. Field-level validation detail is surfaced by the forms. */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return error.message
    if (error.code === 'validation_error') {
      const details = error.details as Array<{ message?: string }> | undefined
      if (details?.length) return details.map((d) => d.message).filter(Boolean).join(' ')
      return 'Please check the values you entered.'
    }
    return error.message
  }
  return fallback
}

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

/** The admin assessment list, with a `reload` for after a create or delete. */
export function useAssessmentList() {
  const api = useApi()
  const [state, setState] = useState<Loadable<AssessmentSummary[]>>({ status: 'loading' })

  const load = useCallback(
    (signal?: AbortSignal) =>
      api<AssessmentSummary[]>('/api/v1/assessments', { signal })
        .then((data) => {
          if (!signal?.aborted) setState({ status: 'ready', data })
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) setState({ status: 'error', message: describeError(error, 'Could not load assessments.') })
        }),
    [api],
  )

  // Synchronising with the server: state changes only once the request settles.
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { state, reload: load }
}

/** One assessment with its questions; `reload` refreshes it after a write. */
export function useAssessment(assessmentId: string | undefined) {
  const api = useApi()
  const [state, setState] = useState<Loadable<AssessmentDetail>>({ status: 'loading' })

  const load = useCallback(
    (signal?: AbortSignal) =>
      assessmentId
        ? api<AssessmentDetail>(`/api/v1/assessments/${assessmentId}`, { signal })
            .then((data) => {
              if (!signal?.aborted) setState({ status: 'ready', data })
            })
            .catch((error: unknown) => {
              if (!signal?.aborted) {
                setState({ status: 'error', message: describeError(error, 'Could not load the assessment.') })
              }
            })
        : Promise.resolve(),
    [api, assessmentId],
  )

  // Synchronising with the server: state changes only once the request settles.
  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { state, reload: load }
}

/** Write operations. Each throws `ApiError`, so callers can show field-level messages. */
export function useAssessmentActions() {
  const api = useApi()

  return {
    createAssessment: useCallback(
      (input: AssessmentInput) => api<AssessmentDetail>('/api/v1/assessments', { method: 'POST', body: input }),
      [api],
    ),
    updateAssessment: useCallback(
      (id: string, patch: AssessmentPatch) =>
        api<AssessmentDetail>(`/api/v1/assessments/${id}`, { method: 'PATCH', body: patch }),
      [api],
    ),
    deleteAssessment: useCallback(
      (id: string) => api<void>(`/api/v1/assessments/${id}`, { method: 'DELETE' }),
      [api],
    ),
    markReady: useCallback(
      (id: string) => api<AssessmentDetail>(`/api/v1/assessments/${id}/ready`, { method: 'POST' }),
      [api],
    ),
    revertToDraft: useCallback(
      (id: string) => api<AssessmentDetail>(`/api/v1/assessments/${id}/draft`, { method: 'POST' }),
      [api],
    ),
    duplicateQuestion: useCallback(
      (assessmentId: string, questionId: string) =>
        api<Question>(`/api/v1/assessments/${assessmentId}/questions/${questionId}/duplicate`, {
          method: 'POST',
        }),
      [api],
    ),
    publish: useCallback(
      (id: string) => api<AssessmentDetail>(`/api/v1/assessments/${id}/publish`, { method: 'POST' }),
      [api],
    ),
    unpublish: useCallback(
      (id: string) => api<AssessmentDetail>(`/api/v1/assessments/${id}/unpublish`, { method: 'POST' }),
      [api],
    ),
    listAssignments: useCallback(
      (id: string) => api<Assignment[]>(`/api/v1/assessments/${id}/assignments`),
      [api],
    ),
    assignCandidates: useCallback(
      (id: string, candidateIds: string[]) =>
        api<AssignmentResult>(`/api/v1/assessments/${id}/assignments`, {
          method: 'POST',
          body: { candidate_ids: candidateIds },
        }),
      [api],
    ),
    unassignCandidate: useCallback(
      (id: string, candidateId: string) =>
        api<void>(`/api/v1/assessments/${id}/assignments/${candidateId}`, { method: 'DELETE' }),
      [api],
    ),
    listCandidates: useCallback(() => api<CandidateSummary[]>('/api/v1/candidates'), [api]),
    createCandidate: useCallback(
      (input: CandidateInput) => api<CandidateSummary>('/api/v1/candidates', { method: 'POST', body: input }),
      [api],
    ),
    reorderQuestions: useCallback(
      (assessmentId: string, questionIds: string[]) =>
        api<Question[]>(`/api/v1/assessments/${assessmentId}/questions/reorder`, {
          method: 'POST',
          body: { question_ids: questionIds },
        }),
      [api],
    ),
    createQuestion: useCallback(
      (assessmentId: string, input: QuestionInput) =>
        api<Question>(`/api/v1/assessments/${assessmentId}/questions`, { method: 'POST', body: input }),
      [api],
    ),
    updateQuestion: useCallback(
      (assessmentId: string, questionId: string, input: QuestionInput) =>
        api<Question>(`/api/v1/assessments/${assessmentId}/questions/${questionId}`, {
          method: 'PATCH',
          body: input,
        }),
      [api],
    ),
    deleteQuestion: useCallback(
      (assessmentId: string, questionId: string) =>
        api<void>(`/api/v1/assessments/${assessmentId}/questions/${questionId}`, { method: 'DELETE' }),
      [api],
    ),
  }
}
