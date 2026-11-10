import { describe, expect, it } from 'vitest'
import {
  filterMonitoringEvents,
  filterMonitoringSessions,
  paginateSessions,
} from '../filters'
import { toAuditEntry, toExamSummary, toSession, type MonitoringEvent, type MonitoringSession } from '../types'

function makeSession(overrides: Partial<MonitoringSession> = {}): MonitoringSession {
  return {
    attemptId: 'att-1',
    proctoringSessionId: 'ps-1',
    candidateId: 'cand-1',
    candidateName: 'Alice Johnson',
    candidateRollNumber: 'CS2026-001',
    assessmentId: 'exam-1',
    assessmentTitle: 'Algorithms Midterm',
    attemptStatus: 'IN_PROGRESS',
    proctoringStatus: 'ACTIVE',
    cameraState: 'READY',
    microphoneState: 'READY',
    fullscreen: true,
    startedAt: '2026-11-10T10:00:00Z',
    devicesReportedAt: '2026-11-10T10:00:05Z',
    ai: {
      status: 'RUNNING',
      reason: null,
      impaired: [],
      face: 'detected',
      faceCount: 'one',
      headOrientation: 'forward',
      gaze: 'not_used',
      cameraQuality: 'good',
      objects: 'none',
      objectsSeen: [],
      active: [],
    },
    candidateConnected: true,
    candidatePresenceChangedAt: '2026-11-10T10:00:00Z',
    tabSwitches: 0,
    tabSwitchLimit: 3,
    onHold: false,
    holdReason: null,
    heldAt: null,
    interruptionCount: 0,
    ...overrides,
  }
}

describe('Phase 4C: Live Administrator Monitoring Foundation', () => {
  describe('4x4 Candidate Grid Pagination', () => {
    it('paginates sessions in pages of 16 and safely clamps out-of-range page indices', () => {
      const items = Array.from({ length: 35 }, (_, i) => makeSession({ attemptId: `att-${i}` }))

      const p0 = paginateSessions(items, 0, 16)
      expect(p0.pageCount).toBe(3)
      expect(p0.clampedPage).toBe(0)
      expect(p0.visible.length).toBe(16)
      expect(p0.visible[0]?.attemptId).toBe('att-0')

      const p1 = paginateSessions(items, 1, 16)
      expect(p1.visible.length).toBe(16)
      expect(p1.visible[0]?.attemptId).toBe('att-16')

      const p2 = paginateSessions(items, 2, 16)
      expect(p2.visible.length).toBe(3)
      expect(p2.visible[0]?.attemptId).toBe('att-32')

      // Clamping beyond max page
      const clamped = paginateSessions(items, 99, 16)
      expect(clamped.clampedPage).toBe(2)
      expect(clamped.visible.length).toBe(3)
    })
  })

  describe('Candidate Search & Status Filtering', () => {
    const alice = makeSession({ attemptId: '1', candidateName: 'Alice Johnson', candidateRollNumber: 'ROLL-101' })
    const bob = makeSession({
      attemptId: '2',
      candidateName: 'Bob Smith',
      candidateRollNumber: 'ROLL-102',
      cameraState: 'UNAVAILABLE',
      interruptionCount: 2,
    })
    const carol = makeSession({
      attemptId: '3',
      candidateName: 'Carol White',
      candidateRollNumber: 'ROLL-103',
      fullscreen: false,
      onHold: true,
    })
    const all = [alice, bob, carol]

    it('filters by candidate name or roll number case-insensitively', () => {
      expect(filterMonitoringSessions(all, 'bob', 'ALL')).toEqual([bob])
      expect(filterMonitoringSessions(all, 'ROLL-103', 'ALL')).toEqual([carol])
      expect(filterMonitoringSessions(all, 'algorithms', 'ALL').length).toBe(3)
    })

    it('filters by operational status categories', () => {
      expect(filterMonitoringSessions(all, '', 'CONNECTED')).toEqual([alice, bob])
      expect(filterMonitoringSessions(all, '', 'INTERRUPTED')).toEqual([bob, carol])
      expect(filterMonitoringSessions(all, '', 'CAMERA_ISSUE')).toEqual([bob])
      expect(filterMonitoringSessions(all, '', 'FULLSCREEN_EXIT')).toEqual([carol])
    })
  })

  describe('Candidate Event Timeline Filtering', () => {
    const events: MonitoringEvent[] = [
      { id: 'e1', eventType: 'FULLSCREEN_EXIT', category: 'WINDOW', severity: 'MEDIUM', metadata: {}, recordedAt: '2026-11-10T10:01:00Z' },
      { id: 'e2', eventType: 'SECURITY_AGENT_DISCONNECTED', category: 'SYSTEM', severity: 'CRITICAL', metadata: {}, recordedAt: '2026-11-10T10:02:00Z' },
      { id: 'e3', eventType: 'ENVIRONMENT_RECOVERY_SUCCEEDED', category: 'RECOVERY', severity: 'INFO', metadata: {}, recordedAt: '2026-11-10T10:03:00Z' },
    ]

    it('filters timeline events by category and severity', () => {
      expect(filterMonitoringEvents(events, 'ALL', 'ALL').length).toBe(3)
      expect(filterMonitoringEvents(events, 'WINDOW', 'ALL')).toEqual([events[0]])
      expect(filterMonitoringEvents(events, 'ALL', 'CRITICAL')).toEqual([events[1]])
      expect(filterMonitoringEvents(events, 'RECOVERY', 'INFO')).toEqual([events[2]])
      expect(filterMonitoringEvents(events, 'WINDOW', 'HIGH')).toEqual([])
    })
  })

  describe('Wire Shape Mapping & Mappers', () => {
    it('maps snake_case backend payloads cleanly to TypeScript interfaces', () => {
      const session = toSession({
        attempt_id: 'att-99',
        proctoring_session_id: 'ps-99',
        candidate_id: 'cand-99',
        candidate_name: 'David Lee',
        candidate_roll_number: 'DL-01',
        assessment_id: 'exam-9',
        assessment_title: 'Physics',
        attempt_status: 'IN_PROGRESS',
        proctoring_status: 'ACTIVE',
        camera_state: 'READY',
        microphone_state: 'READY',
        interruption_count: 1,
        selected_camera_label: 'Integrated HD',
      })
      expect(session.attemptId).toBe('att-99')
      expect(session.interruptionCount).toBe(1)
      expect(session.selectedCameraLabel).toBe('Integrated HD')

      const examSummary = toExamSummary({
        assessment_id: 'exam-9',
        title: 'Physics',
        status: 'PUBLISHED',
        total_assigned: 50,
        active_sessions: 20,
        submitted_count: 10,
        interrupted_count: 1,
      })
      expect(examSummary.title).toBe('Physics')
      expect(examSummary.activeSessions).toBe(20)

      const auditEntry = toAuditEntry({
        id: 'aud-1',
        administrator_id: 'adm-1',
        action: 'STREAM_GRANTED',
        details: { grant: 'g1' },
        created_at: '2026-11-10T10:00:00Z',
      })
      expect(auditEntry.action).toBe('STREAM_GRANTED')
    })
  })
})
