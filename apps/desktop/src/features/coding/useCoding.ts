import { useCallback, useEffect, useMemo, useState } from 'react'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi } from '@/features/session'
import type {
  AdminExecution,
  CodingProblemForCandidate,
  Difficulty,
  Language,
  CodingAnalytics,
  ProblemDetail,
  ProblemSummary,
  TestCase,
  Version,
  VersionPatch,
  Visibility,
} from './types'

export { describeError }

const BASE = '/api/v1/coding-problems'

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

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

export interface LibraryFilters {
  search?: string
  difficulty?: Difficulty | ''
  tag?: string
  language?: string
  publishedOnly?: boolean
  enabledOnly?: boolean
}

export function libraryPath(filters: LibraryFilters = {}): string {
  const query = new URLSearchParams()
  if (filters.search?.trim()) query.set('search', filters.search.trim())
  if (filters.difficulty) query.set('difficulty', filters.difficulty)
  if (filters.tag?.trim()) query.set('tag', filters.tag.trim())
  if (filters.language) query.set('language', filters.language)
  if (filters.publishedOnly) query.set('published_only', 'true')
  if (filters.enabledOnly) query.set('enabled_only', 'true')
  const qs = query.toString()
  return qs ? `${BASE}?${qs}` : BASE
}

export const useLibrary = (filters: LibraryFilters) =>
  useLoad<ProblemSummary[]>(libraryPath(filters), 'Could not load the coding problems.')

export const useProblem = (id: string) => useLoad<ProblemDetail>(`${BASE}/${id}`, 'Could not load the problem.')

export const useLanguages = () =>
  useLoad<{ languages: Language[]; starters: Record<string, string> }>(`${BASE}/languages`, 'Could not load languages.')

/** An assessment's coding analytics. Admin-only; the server enforces that. */
export const useCodingAnalytics = (assessmentId: string) =>
  useLoad<CodingAnalytics>(`/api/v1/assessments/${assessmentId}/coding-analytics`, 'Could not load the coding analytics.')

/** Every library write. Each resolves with the server's response. */
export function useCodingActions() {
  const api = useApi()
  return useMemo(
    () => ({
      create: (input: { title: string; difficulty: Difficulty; tags: string[] }) =>
        api<ProblemDetail>(BASE, { method: 'POST', body: input }),
      setEnabled: (id: string, is_enabled: boolean) =>
        api<ProblemDetail>(`${BASE}/${id}`, { method: 'PATCH', body: { is_enabled } }),
      remove: (id: string) => api<void>(`${BASE}/${id}`, { method: 'DELETE' }),
      version: (id: string, versionId: string) => api<Version>(`${BASE}/${id}/versions/${versionId}`),
      updateVersion: (id: string, versionId: string, patch: VersionPatch) =>
        api<Version>(`${BASE}/${id}/versions/${versionId}`, { method: 'PATCH', body: patch }),
      newVersion: (id: string) => api<Version>(`${BASE}/${id}/versions`, { method: 'POST' }),
      discardDraft: (id: string, versionId: string) =>
        api<void>(`${BASE}/${id}/versions/${versionId}`, { method: 'DELETE' }),
      publish: (id: string, versionId: string) =>
        api<Version>(`${BASE}/${id}/versions/${versionId}/publish`, { method: 'POST' }),
      preview: (id: string, versionId: string) =>
        api<CodingProblemForCandidate>(`${BASE}/${id}/versions/${versionId}/preview`),
      addTest: (id: string, versionId: string, input: { visibility: Visibility; input: string; expected_output: string; weight: number }) =>
        api<TestCase>(`${BASE}/${id}/versions/${versionId}/test-cases`, { method: 'POST', body: input }),
      updateTest: (id: string, versionId: string, testId: string, patch: Partial<Omit<TestCase, 'id' | 'position'>>) =>
        api<TestCase>(`${BASE}/${id}/versions/${versionId}/test-cases/${testId}`, { method: 'PATCH', body: patch }),
      deleteTest: (id: string, versionId: string, testId: string) =>
        api<void>(`${BASE}/${id}/versions/${versionId}/test-cases/${testId}`, { method: 'DELETE' }),
      validate: (id: string, versionId: string) =>
        api<AdminExecution>(`${BASE}/${id}/versions/${versionId}/validate`, { method: 'POST' }),
      validation: (id: string, versionId: string) => api<AdminExecution>(`${BASE}/${id}/versions/${versionId}/validation`),
      addToAssessment: (assessmentId: string, problemVersionId: string, marks?: number) =>
        api(`/api/v1/assessments/${assessmentId}/coding-questions`, {
          method: 'POST',
          body: { problem_version_id: problemVersionId, ...(marks ? { marks } : {}) },
        }),
    }),
    [api],
  )
}
