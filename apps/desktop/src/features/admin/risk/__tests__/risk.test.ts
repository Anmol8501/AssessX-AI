import { describe, expect, it } from 'vitest'
import { formatPoints, formatSeconds, riskLevel } from '../labels'
import { toRisk } from '../types'

const RAW = {
  attempt_id: 'a1',
  policy_version: '6A-v1',
  calculated_at: '2026-10-01T10:00:05Z',
  as_of: '2026-10-01T10:00:00Z',
  current_score: 47,
  level: 'LOW',
  peak_score: 62,
  peak_level: 'MEDIUM',
  peak_at: '2026-10-01T09:40:00Z',
  signal_count: 3,
  contributors: [
    { event_type: 'FACE_NOT_DETECTED', tier: 'MEDIUM', occurrences: 2, total_seconds: 14, points: 23, current_points: 15.2, reason: 'No face…' },
  ],
  correlated_windows: [
    { started_at: '2026-10-01T09:40:00Z', ended_at: '2026-10-01T09:40:09Z', event_types: ['FACE_NOT_DETECTED', 'FOCUS_LOST'], categories: ['AI_OBSERVATION', 'WINDOW'], signal_count: 2, bonus_points: 5.1 },
  ],
  correlated_window_count: 1,
  excluded: [{ event_type: 'SESSION_STARTED', count: 1, reason: 'Session lifecycle.' }],
  ai_unavailable_seconds: 0,
  interpretation: 'This risk score summarises observable events for human review. It is not a determination that the candidate cheated, and it does not reject anyone.',
  limitations: 'Most signals are reported by the candidate’s app…',
}

describe('toRisk', () => {
  it('maps the server response without computing anything', () => {
    const risk = toRisk(RAW)
    expect(risk).toMatchObject({ attemptId: 'a1', policyVersion: '6A-v1', currentScore: 47, level: 'LOW', peakScore: 62, peakLevel: 'MEDIUM' })
    expect(risk.contributors[0]).toEqual({
      eventType: 'FACE_NOT_DETECTED',
      tier: 'MEDIUM',
      occurrences: 2,
      totalSeconds: 14,
      points: 23,
      currentPoints: 15.2,
      reason: 'No face…',
    })
    expect(risk.correlatedWindows[0]).toMatchObject({ eventTypes: ['FACE_NOT_DETECTED', 'FOCUS_LOST'], signalCount: 2 })
  })

  it('tolerates an empty assessment', () => {
    const risk = toRisk({ ...RAW, contributors: [], correlated_windows: [], correlated_window_count: 0, peak_at: null })
    expect(risk.contributors).toEqual([])
    expect(risk.peakAt).toBeNull()
  })
})

describe('labels', () => {
  it('maps every level to a neutral label and tone', () => {
    expect(riskLevel('NORMAL')).toEqual({ label: 'Normal', tone: 'ok' })
    expect(riskLevel('LOW')).toEqual({ label: 'Low', tone: 'neutral' })
    expect(riskLevel('MEDIUM')).toEqual({ label: 'Medium', tone: 'warn' })
    expect(riskLevel('HIGH')).toEqual({ label: 'High', tone: 'danger' })
  })

  it('never uses verdict wording', () => {
    const words = (['NORMAL', 'LOW', 'MEDIUM', 'HIGH'] as const).map((l) => riskLevel(l).label.toLowerCase())
    for (const word of words) expect(word).not.toMatch(/cheat|fraud|guilt|suspicious|reject/)
  })

  it('formats durations and points', () => {
    expect(formatSeconds(0.4)).toBe('')
    expect(formatSeconds(14)).toBe('14s')
    expect(formatSeconds(125)).toBe('2m 05s')
    expect(formatPoints(15)).toBe('15')
    expect(formatPoints(15.24)).toBe('15.2')
  })
})
