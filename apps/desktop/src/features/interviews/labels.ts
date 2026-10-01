/**
 * Labels for interviews (Phase 7A). Descriptive only: nothing here rates a candidate or an answer,
 * because Phase 7A does not evaluate answers.
 */

import type { StatusTone } from '@/components/ui'
import type { CompletionReason, Difficulty, InterviewStatus, InterviewType, QuestionType, SessionStatus } from './types'

export const INTERVIEW_TYPES: Record<InterviewType, string> = {
  TECHNICAL: 'Technical',
  BEHAVIORAL: 'Behavioral',
  MIXED: 'Mixed',
}

export const DIFFICULTIES: Record<Difficulty, string> = { EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' }

export const QUESTION_TYPES: Record<QuestionType, string> = {
  TECHNICAL: 'Technical',
  BEHAVIORAL: 'Behavioral',
  CONCEPTUAL: 'Conceptual',
  SCENARIO: 'Scenario',
}

export function interviewStatusLabel(status: InterviewStatus): { label: string; tone: StatusTone } {
  return status === 'PUBLISHED' ? { label: 'Published', tone: 'ok' } : { label: 'Draft', tone: 'neutral' }
}

const SESSION: Record<SessionStatus, { label: string; tone: StatusTone }> = {
  NOT_STARTED: { label: 'Not started', tone: 'neutral' },
  ACTIVE: { label: 'In progress', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'ok' },
}

export function sessionStatusLabel(status: SessionStatus): { label: string; tone: StatusTone } {
  return SESSION[status] ?? { label: status, tone: 'neutral' }
}

const REASON: Record<CompletionReason, string> = {
  ALL_ANSWERED: 'All questions answered',
  TIME_EXPIRED: 'Time ran out',
  ENDED_BY_CANDIDATE: 'Ended early',
}

export function completionLabel(reason: CompletionReason | null): string {
  return reason ? REASON[reason] ?? reason : ''
}
