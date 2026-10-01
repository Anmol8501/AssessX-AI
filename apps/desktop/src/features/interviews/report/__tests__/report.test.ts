import { describe, expect, it } from 'vitest'
import { answerStateLabel, decisionReason, evaluationStateLabel, historyLabel, minutes, outcomeLabel, reviewStatusLabel } from '../labels'

const OUTCOMES = ['MEETS_EXPECTATIONS', 'NEEDS_FURTHER_ASSESSMENT', 'DOES_NOT_MEET_EXPECTATIONS', 'INCONCLUSIVE'] as const

describe('interview report labels (Phase 7C)', () => {
  it('describe a human interpretation — never a hiring verdict, an AI decision or a ranking', () => {
    const texts = [
      ...OUTCOMES.map((o) => outcomeLabel(o).label),
      ...(['UNREVIEWED', 'IN_REVIEW', 'REVIEWED'] as const).map((s) => reviewStatusLabel(s).label),
    ]
    for (const text of texts) expect(text).not.toMatch(/hire|reject|cheat|rank|best|ai decid|recommend/i)
  })

  it('keep not answered, not evaluated, pending and evaluated distinct', () => {
    const labels = (['NOT_ANSWERED', 'EVALUATION_PENDING', 'ANSWERED_NOT_EVALUATED', 'EVALUATED'] as const).map(
      (s) => answerStateLabel(s).label,
    )
    expect(new Set(labels).size).toBe(4)
    expect(answerStateLabel('ANSWERED_NOT_EVALUATED').label).toContain('not evaluated')
    expect(evaluationStateLabel('PARTIAL')).toBe('Partially evaluated')
  })

  it('explain the adaptive policy by its recorded reason codes', () => {
    expect(decisionReason('strong_answer')).toBe('strong answer — one level harder')
    expect(decisionReason('weak_answer+follow_up')).toBe('weak answer — one level easier; follow-up asked')
    expect(decisionReason('no_evaluation_signal')).toContain('fallback')
  })

  it('build history lines from allow-listed details only', () => {
    expect(historyLabel('INTERVIEW_REVIEW_REVISED', { outcome: 'INCONCLUSIVE', previous_outcome: 'MEETS_EXPECTATIONS' })).toBe(
      'Revised the outcome: Meets expectations → Inconclusive',
    )
    expect(historyLabel('INTERVIEW_REVIEW_ANSWER_MARKED', { mark: 'DISAGREE' })).toBe('Marked an AI evaluation: disagrees')
    expect(historyLabel('INTERVIEW_REVIEW_NOTE_ADDED', { length: 30 })).toBe('Added a note')
    expect(minutes(125)).toBe('2 min 05 s')
  })
})
