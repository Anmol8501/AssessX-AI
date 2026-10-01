/**
 * Labels for the interview report and its review (Phase 7C). Outcomes are a person's administrative
 * interpretation — never phrased as an AI verdict, a hiring decision or a ranking.
 */

import type { StatusTone } from '@/components/ui'
import type { AnswerState, EvaluationState, ReviewOutcome, ReviewStatus } from './types'

const OUTCOME: Record<ReviewOutcome, { label: string; tone: StatusTone }> = {
  MEETS_EXPECTATIONS: { label: 'Meets expectations', tone: 'ok' },
  NEEDS_FURTHER_ASSESSMENT: { label: 'Needs further assessment', tone: 'warn' },
  DOES_NOT_MEET_EXPECTATIONS: { label: 'Does not meet expectations', tone: 'neutral' },
  INCONCLUSIVE: { label: 'Inconclusive', tone: 'neutral' },
}

export function outcomeLabel(outcome: ReviewOutcome): { label: string; tone: StatusTone } {
  return OUTCOME[outcome] ?? { label: outcome, tone: 'neutral' }
}

const REVIEW: Record<ReviewStatus, { label: string; tone: StatusTone }> = {
  UNREVIEWED: { label: 'Unreviewed', tone: 'neutral' },
  IN_REVIEW: { label: 'In review', tone: 'info' },
  REVIEWED: { label: 'Reviewed', tone: 'ok' },
}

export function reviewStatusLabel(status: ReviewStatus): { label: string; tone: StatusTone } {
  return REVIEW[status] ?? { label: status, tone: 'neutral' }
}

const ANSWER: Record<AnswerState, { label: string; tone: StatusTone }> = {
  NOT_ANSWERED: { label: 'Not answered', tone: 'neutral' },
  EVALUATION_PENDING: { label: 'Evaluation pending', tone: 'info' },
  ANSWERED_NOT_EVALUATED: { label: 'Answered — not evaluated', tone: 'warn' },
  EVALUATED: { label: 'AI-evaluated', tone: 'ok' },
}

export function answerStateLabel(state: AnswerState): { label: string; tone: StatusTone } {
  return ANSWER[state] ?? { label: state, tone: 'neutral' }
}

const EVALUATION: Record<EvaluationState, string> = {
  NONE: 'No AI evaluations',
  PENDING: 'Evaluations in progress',
  PARTIAL: 'Partially evaluated',
  COMPLETE: 'All answers evaluated',
}

export function evaluationStateLabel(state: EvaluationState): string {
  return EVALUATION[state] ?? state
}

const ACTION: Record<string, string> = {
  INTERVIEW_REVIEW_STARTED: 'Started the review',
  INTERVIEW_REVIEW_NOTE_ADDED: 'Added a note',
  INTERVIEW_REVIEW_ANSWER_MARKED: 'Marked an AI evaluation',
  INTERVIEW_REVIEW_COMPLETED: 'Recorded the outcome',
  INTERVIEW_REVIEW_REVISED: 'Revised the outcome',
}

export function historyLabel(action: string, details: Record<string, unknown>): string {
  const base = ACTION[action] ?? action
  const outcome = typeof details.outcome === 'string' ? outcomeLabel(details.outcome as ReviewOutcome).label : null
  const previous =
    typeof details.previous_outcome === 'string' ? outcomeLabel(details.previous_outcome as ReviewOutcome).label : null
  if (action === 'INTERVIEW_REVIEW_REVISED' && outcome) return `${base}: ${previous ?? '—'} → ${outcome}`
  if (outcome) return `${base}: ${outcome}`
  if (typeof details.mark === 'string') return `${base}: ${details.mark === 'AGREE' ? 'agrees' : 'disagrees'}`
  return base
}

const DECISION_REASON: Record<string, string> = {
  strong_answer: 'strong answer — one level harder',
  weak_answer: 'weak answer — one level easier',
  within_band: 'difficulty unchanged',
  low_confidence_no_change: 'low evaluation confidence — difficulty unchanged',
  no_evaluation_signal: 'no evaluation in time — fallback rule',
  no_evaluator_configured: 'no evaluator configured',
}

/** A recorded adaptive-policy reason code, in words. Policy rules — not AI reasoning. */
export function decisionReason(reason: string): string {
  const [base, extra] = reason.split('+')
  const text = DECISION_REASON[base ?? ''] ?? base ?? ''
  return extra === 'follow_up' ? `${text}; follow-up asked` : text
}

export function minutes(seconds: number): string {
  const m = Math.floor(seconds / 60)
  return m > 0 ? `${m} min ${String(seconds % 60).padStart(2, '0')} s` : `${seconds} s`
}
