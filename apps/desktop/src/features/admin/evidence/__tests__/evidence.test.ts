import { describe, expect, it } from 'vitest'
import { contributionLabel, durationLabel, statusLabel } from '../labels'
import { mergePages, toPage, type EvidenceStatus } from '../types'

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  evidence_id: id,
  event_type: 'FACE_NOT_DETECTED',
  category: 'AI_OBSERVATION',
  kind: 'INTERVAL',
  status: 'RESOLVED',
  started_at: '2026-10-01T10:20:01Z',
  ended_at: '2026-10-01T10:20:06Z',
  duration_seconds: 5,
  counted_seconds: 5,
  resolution: 'condition_cleared',
  tier: 'MEDIUM',
  points: 10.5,
  current_points: 9.8,
  episode_id: 'ep1',
  source_event_ids: [id, `${id}-end`],
  explanation: 'No face was detected in the camera view for a sustained interval. It lasted 5.0 s.',
  ...extra,
})

const page = (items: ReturnType<typeof item>[], next: string | null = null) => ({
  total: 3,
  items,
  episodes: [{ episode_id: 'ep1', started_at: 'x', ended_at: null, status: 'ONGOING', member_ids: ['a', 'b'], event_types: [], bonus_points: 2, explanation: 'e' }],
  next_cursor: next,
  session_live: true,
  policy_version: '6A-v1',
  evidence_version: '6B-v1',
  interpretation: 'Evidence describes what the proctoring system observed. It does not determine intent…',
})

describe('evidence mapping', () => {
  it('maps a page without computing anything', () => {
    const p = toPage(page([item('a')], 'cur'))
    expect(p).toMatchObject({ total: 3, nextCursor: 'cur', sessionLive: true, policyVersion: '6A-v1', evidenceVersion: '6B-v1' })
    expect(p.items[0]).toMatchObject({ evidenceId: 'a', status: 'RESOLVED', durationSeconds: 5, episodeId: 'ep1', sourceEventIds: ['a', 'a-end'] })
    expect(p.episodes[0]).toMatchObject({ episodeId: 'ep1', memberIds: ['a', 'b'], endedAt: null })
  })

  it('keeps a missing end as null — never estimated', () => {
    const p = toPage(page([item('a', { status: 'NO_END_RECORDED', ended_at: null, duration_seconds: null, counted_seconds: 42 })]))
    expect(p.items[0]).toMatchObject({ endedAt: null, durationSeconds: null, countedSeconds: 42 })
  })

  it('merges pages in order without duplicates', () => {
    const merged = mergePages([toPage(page([item('a'), item('b')], 'c')), toPage(page([item('b'), item('c')]))])
    expect(merged.items.map((i) => i.evidenceId)).toEqual(['a', 'b', 'c'])
    expect(merged.episodes.get('ep1')?.memberIds).toEqual(['a', 'b'])
  })
})

describe('evidence labels', () => {
  it('describes lifecycle honestly', () => {
    expect(durationLabel({ status: 'RESOLVED', durationSeconds: 5.1, countedSeconds: 5.1 })).toBe('5.1 s')
    expect(durationLabel({ status: 'INSTANT', durationSeconds: 0, countedSeconds: 0 })).toBe('')
    expect(durationLabel({ status: 'ONGOING', durationSeconds: null, countedSeconds: 12 })).toBe('12 s so far')
    expect(durationLabel({ status: 'NO_END_RECORDED', durationSeconds: null, countedSeconds: 125 })).toBe('no end recorded (2 min 05 s counted)')
    expect(contributionLabel({ tier: 'HIGH', points: 25 })).toBe('High · 25 pts')
  })

  it('never uses verdict or intent wording', () => {
    const statuses: EvidenceStatus[] = ['INSTANT', 'ONGOING', 'RESOLVED', 'NO_END_RECORDED']
    for (const s of statuses) expect(statusLabel(s).label.toLowerCase()).not.toMatch(/cheat|fraud|guilt|intent|suspicious|violation/)
  })
})
