/**
 * Labels for the human review (Phase 6C). Administrative language only: an outcome is a person's
 * recorded decision, never a statement that a candidate cheated, and never inferred from risk.
 * No verdict wording may be added here.
 */

import type { StatusTone } from '@/components/ui'
import type { EvidenceMark, ReviewOutcome, ReviewStatus } from './types'

const STATUS: Record<ReviewStatus, { label: string; tone: StatusTone }> = {
  UNREVIEWED: { label: 'Unreviewed', tone: 'neutral' },
  IN_REVIEW: { label: 'In review', tone: 'info' },
  REVIEWED: { label: 'Reviewed', tone: 'ok' },
}

export function reviewStatusLabel(status: ReviewStatus): { label: string; tone: StatusTone } {
  return STATUS[status] ?? { label: status, tone: 'neutral' }
}

const OUTCOME: Record<ReviewOutcome, { label: string; tone: StatusTone }> = {
  NO_ACTION: { label: 'No action', tone: 'neutral' },
  CLEARED: { label: 'Cleared', tone: 'ok' },
  FLAGGED: { label: 'Flagged for follow-up', tone: 'warn' },
  INVALIDATED: { label: 'Invalidated', tone: 'danger' },
}

export function outcomeLabel(outcome: ReviewOutcome): { label: string; tone: StatusTone } {
  return OUTCOME[outcome] ?? { label: outcome, tone: 'neutral' }
}

const MARK: Record<EvidenceMark, { label: string; tone: StatusTone }> = {
  CONFIRMED: { label: 'Observation confirmed', tone: 'info' },
  DISMISSED: { label: 'Dismissed', tone: 'neutral' },
}

export function markLabel(mark: EvidenceMark): { label: string; tone: StatusTone } {
  return MARK[mark] ?? { label: mark, tone: 'neutral' }
}

const ACTION: Record<string, string> = {
  REVIEW_STARTED: 'Started the review',
  REVIEW_NOTE_ADDED: 'Added a note',
  REVIEW_EVIDENCE_MARKED: 'Marked evidence',
  REVIEW_COMPLETED: 'Recorded the outcome',
  REVIEW_REVISED: 'Revised the outcome',
}

/** One line of the review history, built only from allow-listed audit details. */
export function historyLabel(action: string, details: Record<string, unknown>): string {
  const base = ACTION[action] ?? action
  const outcome = typeof details.outcome === 'string' ? outcomeLabel(details.outcome as ReviewOutcome).label : null
  const previous =
    typeof details.previous_outcome === 'string' ? outcomeLabel(details.previous_outcome as ReviewOutcome).label : null
  const mark = typeof details.mark === 'string' ? markLabel(details.mark as EvidenceMark).label : null
  if (action === 'REVIEW_REVISED' && outcome) return `${base}: ${previous ?? '—'} → ${outcome}`
  if (outcome) return `${base}: ${outcome}`
  if (mark) return `${base}: ${mark}`
  return base
}

export function dateTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString()
}
