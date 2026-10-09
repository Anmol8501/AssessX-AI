import type { MyAssessment } from '@/features/assessments/types'
import { usePagedList } from '@/features/session'

/**
 * The assessments assigned to the signed-in candidate, newest first, one page at a time. The server scopes
 * this to the session's own user, and never returns questions or answer keys.
 */
export function useMyAssessments() {
  return usePagedList<MyAssessment>('/api/v1/candidates/me/assessments', 'Could not load your exams.')
}
