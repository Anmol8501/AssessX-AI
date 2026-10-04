import { LANGUAGE_NAME, VERDICT_LABEL } from '@/features/coding/types'
import type { StatusTone } from '@/components/ui'
import type { AnswerOutcome, QuestionResult } from './types'

export function outcomeTone(outcome: AnswerOutcome): StatusTone {
  if (outcome === 'CORRECT') return 'ok'
  if (outcome === 'INCORRECT') return 'danger'
  if (outcome === 'PARTIAL') return 'warn'
  return 'neutral'
}

/**
 * A coding question's line in a result: tests passed of all tests (never which ones), the verdict and
 * the language. Null for a multiple-choice question.
 */
export function codingDetail(question: QuestionResult): string | null {
  if (question.kind !== 'CODING') return null
  if (question.tests_total === null) return 'No submission'
  const verdict = question.verdict ? (VERDICT_LABEL[question.verdict] ?? question.verdict) : null
  const language = question.language ? (LANGUAGE_NAME[question.language] ?? question.language) : null
  return [`${question.tests_passed ?? 0} / ${question.tests_total} tests passed`, verdict, language]
    .filter(Boolean)
    .join(' · ')
}

/** `7 / 10`, or null when the section does not exist. */
export function sectionText(score: number | null, maximum: number | null): string | null {
  return maximum === null ? null : `${score ?? 0} / ${maximum}`
}
