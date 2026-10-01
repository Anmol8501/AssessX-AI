import { describe, expect, it } from 'vitest'
import { riskLevel } from '../../risk/labels'
import { historyLabel, markLabel, outcomeLabel, reviewStatusLabel } from '../labels'
import { marksById, toQueue, toReview, type ReviewOutcome } from '../types'

const admin = { id: 'u1', name: 'Ada Admin' }

const decision = (revision: number, outcome: ReviewOutcome, level = 'HIGH') => ({
  revision,
  authored_by: 'HUMAN',
  outcome,
  outcome_description: 'Reviewed.',
  rationale: 'Checked the timeline.',
  decided_by: admin,
  decided_at: '2026-10-01T11:00:00Z',
  basis: {
    policy_version: '6A-v1',
    evidence_version: '6B-v1',
    as_of: '2026-10-01T10:59:00Z',
    risk_score: 82,
    risk_level: level,
    peak_score: 90,
    peak_level: 'HIGH',
    signal_count: 7,
    evidence_count: 7,
    episode_count: 2,
  },
})

const review = (extra: Record<string, unknown> = {}) => ({
  context: {
    attempt_id: 'a1',
    attempt_number: 1,
    attempt_status: 'SUBMITTED',
    started_at: '2026-10-01T10:00:00Z',
    finalized_at: '2026-10-01T10:58:00Z',
    assessment_id: 's1',
    assessment_title: 'Java Fundamentals',
    candidate_id: 'c1',
    candidate_name: 'Cal Candidate',
    candidate_roll_number: 'R1',
    proctoring_status: 'ENDED',
  },
  status: 'REVIEWED',
  version: 3,
  outcome: 'CLEARED',
  started_by: admin,
  started_at: '2026-10-01T10:59:00Z',
  completed_by: admin,
  completed_at: '2026-10-01T11:05:00Z',
  can_complete: true,
  notes: [{ note_id: 'n1', authored_by: 'HUMAN', author: admin, body: 'A person walked past.', created_at: '2026-10-01T11:00:00Z' }],
  decisions: [decision(2, 'CLEARED'), decision(1, 'FLAGGED')],
  marks: [{ evidence_id: 'e1', mark: 'DISMISSED', marked_by: admin, marked_at: '2026-10-01T11:01:00Z' }],
  history: [
    { action: 'REVIEW_REVISED', actor: admin, occurred_at: '2026-10-01T11:05:00Z', details: { outcome: 'CLEARED', previous_outcome: 'FLAGGED' } },
  ],
  outcome_options: (['NO_ACTION', 'CLEARED', 'FLAGGED', 'INVALIDATED'] as const).map((o) => ({ outcome: o, description: 'd' })),
  interpretation: 'This review is written by an administrator…',
  ...extra,
})

describe('review mapping', () => {
  it('keeps the human outcome and the system risk as separate fields', () => {
    const r = toReview(review())
    expect(r.outcome).toBe('CLEARED') // human
    expect(r.decisions[0]?.basis.riskLevel).toBe('HIGH') // system, recorded alongside — not overriding
    expect(r.decisions.map((d) => [d.revision, d.outcome])).toEqual([
      [2, 'CLEARED'],
      [1, 'FLAGGED'],
    ])
    expect(r.notes[0]).toMatchObject({ noteId: 'n1', author: admin, body: 'A person walked past.' })
    expect(r.context).toMatchObject({ candidateName: 'Cal Candidate', assessmentTitle: 'Java Fundamentals' })
    expect(marksById(r)).toEqual({ e1: 'DISMISSED' })
  })

  it('maps an unreviewed attempt without inventing a reviewer, a version or an outcome', () => {
    const r = toReview(review({ status: 'UNREVIEWED', version: null, outcome: null, started_by: null, started_at: null, completed_by: null, completed_at: null, notes: [], decisions: [], marks: [], history: [] }))
    expect(r).toMatchObject({ status: 'UNREVIEWED', version: null, outcome: null, startedBy: null, completedBy: null })
    expect(marksById(r)).toEqual({})
    expect(marksById(null)).toEqual({})
  })

  it('maps the queue with risk and outcome side by side', () => {
    const q = toQueue({
      counts: { UNREVIEWED: 8, IN_REVIEW: 2, REVIEWED: 41 },
      items: [
        {
          attempt_id: 'a1', attempt_number: 1, attempt_status: 'SUBMITTED', started_at: 's', finalized_at: 'f',
          assessment_id: 's1', assessment_title: 'Java', candidate_name: 'Cal', candidate_roll_number: null,
          risk_level: 'HIGH', risk_score: 82, peak_level: 'HIGH', review_status: 'REVIEWED', outcome: 'CLEARED',
          reviewed_by: admin, reviewed_at: 'r',
        },
      ],
      next_cursor: 'c',
      interpretation: 'i',
    })
    expect(q.counts).toEqual({ UNREVIEWED: 8, IN_REVIEW: 2, REVIEWED: 41 })
    expect(q.items[0]).toMatchObject({ riskLevel: 'HIGH', outcome: 'CLEARED', reviewStatus: 'REVIEWED', reviewedBy: admin })
    expect(q.nextCursor).toBe('c')
  })
})

describe('review labels', () => {
  const VERDICT = /cheat|guilt|fraud|dishonest|misconduct|prove|intent/i

  it('uses administrative language only', () => {
    const texts = [
      ...(['NO_ACTION', 'CLEARED', 'FLAGGED', 'INVALIDATED'] as const).map((o) => outcomeLabel(o).label),
      ...(['UNREVIEWED', 'IN_REVIEW', 'REVIEWED'] as const).map((s) => reviewStatusLabel(s).label),
      ...(['CONFIRMED', 'DISMISSED'] as const).map((m) => markLabel(m).label),
    ]
    for (const text of texts) expect(text).not.toMatch(VERDICT)
  })

  it('never derives an outcome label from a risk level', () => {
    // The two vocabularies do not overlap, so "High" can never be read as an outcome.
    const outcomes = new Set((['NO_ACTION', 'CLEARED', 'FLAGGED', 'INVALIDATED'] as const).map((o) => outcomeLabel(o).label))
    for (const level of ['NORMAL', 'LOW', 'MEDIUM', 'HIGH'] as const) expect(outcomes.has(riskLevel(level).label)).toBe(false)
  })

  it('describes history from allow-listed details only', () => {
    expect(historyLabel('REVIEW_REVISED', { outcome: 'CLEARED', previous_outcome: 'FLAGGED' })).toBe(
      'Revised the outcome: Flagged for follow-up → Cleared',
    )
    expect(historyLabel('REVIEW_COMPLETED', { outcome: 'NO_ACTION' })).toBe('Recorded the outcome: No action')
    expect(historyLabel('REVIEW_EVIDENCE_MARKED', { mark: 'DISMISSED' })).toBe('Marked evidence: Dismissed')
    expect(historyLabel('REVIEW_NOTE_ADDED', { note_id: 'n1', length: 20 })).toBe('Added a note')
  })
})
