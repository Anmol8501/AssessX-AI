import type { CodingStatus } from '@/features/coding/types'
import type { AnswerState, CandidateQuestion } from './types'

/** Whether a question counts as answered: options chosen, or (coding) at least one submission. */
export function isAnswered(question: CandidateQuestion, answers: Record<string, AnswerState>, codingStatus?: Record<string, CodingStatus>) {
  if (question.type === 'CODING') {
    const status = codingStatus?.[question.id]
    return status === 'PASSED' || status === 'NOT_PASSED' || status === 'PENDING'
  }
  return (answers[question.id]?.length ?? 0) > 0
}
