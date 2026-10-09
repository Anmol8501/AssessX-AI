import { describe, expect, it } from 'vitest'
import { clipDuration, clipStatusLabel, clipTitle, clipUnavailableReason, toClipDetail } from '../clips'
import { toItem } from '../types'

const raw = {
  clip_id: 'c1',
  status: 'READY',
  source_type: 'PRIMARY_CAMERA',
  has_video: true,
  event_at: '2026-10-06T10:00:05Z',
  window_starts_at: '2026-10-06T10:00:00Z',
  window_ends_at: '2026-10-06T10:00:15Z',
  duration_ms: 15_400,
  byte_size: 480_000,
  sha256: 'a'.repeat(64),
  failure_reason: null,
  retain_until: '2026-11-05T10:00:15Z',
  events: [
    { event_id: 'e1', event_type: 'FACE_NOT_DETECTED', recorded_at: '2026-10-06T10:00:05Z', trigger: true },
    { event_id: 'e2', event_type: 'MULTIPLE_FACES_DETECTED', recorded_at: '2026-10-06T10:00:09Z', trigger: false },
  ],
}

describe('evidence clips in the admin review', () => {
  it('maps the server shape, including every event the clip covers', () => {
    const detail = toClipDetail(raw)
    expect(detail.events.map((e) => e.eventType)).toEqual(['FACE_NOT_DETECTED', 'MULTIPLE_FACES_DETECTED'])
    expect(detail.events[0]!.trigger).toBe(true)
    expect(detail.hasVideo).toBe(true)
  })

  it('a timeline item carries its clip, or none', () => {
    const base = { evidence_id: 'e1', event_type: 'FACE_NOT_DETECTED', source_event_ids: ['e1'], explanation: 'x' }
    expect(toItem({ ...base, clip: { clip_id: 'c1', status: 'FAILED', source_type: 'PRIMARY_CAMERA', duration_ms: null, has_video: false } }).clip).toEqual({
      clipId: 'c1',
      status: 'FAILED',
      sourceType: 'PRIMARY_CAMERA',
      durationMs: null,
      hasVideo: false,
    })
    expect(toItem(base).clip).toBeNull()
  })

  it('titles and labels are factual — never a verdict', () => {
    expect(clipTitle('MULTIPLE_FACES_DETECTED')).toMatch(/^Evidence: /)
    const words = [
      clipTitle('FACE_NOT_DETECTED'),
      ...(['CREATING', 'READY', 'FAILED', 'EXPIRED', 'DELETED'] as const).map((s) => clipStatusLabel(s).label),
      ...(['CREATING', 'FAILED', 'EXPIRED', 'DELETED'] as const).map((status) => clipUnavailableReason({ status, failureReason: 'upload_missing' })),
    ]
      .join(' ')
      .toLowerCase()
    expect(words).not.toMatch(/cheat|guilt|proof|prove|suspicious|fraud|confirmed/)
  })

  it('explains a missing video without hiding that the event stands', () => {
    expect(clipUnavailableReason({ status: 'FAILED', failureReason: 'upload_missing' })).toContain('The event itself is recorded')
    expect(clipUnavailableReason({ status: 'EXPIRED', failureReason: null })).toContain('retention')
  })

  it('durations are honest about what was reported', () => {
    expect(clipDuration(15_400)).toBe('15.4 s')
    expect(clipDuration(null)).toBe('length not reported')
  })
})
