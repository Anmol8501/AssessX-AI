import { describe, expect, it } from 'vitest'
import { tileStatus } from '@/features/admin/monitoring/status'
import { toSession } from '@/features/admin/monitoring/types'
import { AI_EVENT_TYPES } from '../../ai/events/config'
import { aiWarningMessage, EXAM_RULES } from '../examRules'

describe('exam rules shown to candidates', () => {
  it('state the tab-switch rule: two warnings, then the exam is locked', () => {
    const rule = EXAM_RULES.find((r) => r.title === 'Stay in the exam window')!
    expect(rule.detail).toContain('2 warnings')
    expect(rule.detail).toContain('3rd time locks your exam')
    expect(EXAM_RULES.some((r) => r.detail.includes('Windows key'))).toBe(true)
  })

  it('tell the truth about recording: events, never video', () => {
    const text = EXAM_RULES.map((r) => r.detail).join(' ')
    expect(text).not.toMatch(/everything is recorded/i)
  })

  it('give a plain instruction for every AI observation, without accusing', () => {
    for (const type of AI_EVENT_TYPES) {
      const message = aiWarningMessage(type)
      expect(message, type).toBeTruthy()
      expect(message!).not.toMatch(/cheat|suspicious|violation/i)
    }
    expect(aiWarningMessage('SOMETHING_ELSE')).toBeNull()
  })
})

describe('exam control on the monitoring wall', () => {
  const base = {
    attempt_id: 'a',
    proctoring_session_id: 'p',
    candidate_id: 'c',
    candidate_name: 'Asha',
    candidate_roll_number: null,
    assessment_id: 's',
    assessment_title: 'Exam',
    attempt_status: 'IN_PROGRESS',
    proctoring_status: 'ACTIVE',
    camera_state: 'READY',
    microphone_state: 'READY',
    fullscreen: true,
    started_at: null,
    devices_reported_at: null,
    candidate_connected: true,
  }

  it('reads the tab-switch count and the hold from the server', () => {
    const session = toSession({ ...base, tab_switches: 2, tab_switch_limit: 3, on_hold: true, hold_reason: 'TAB_SWITCH_LIMIT' })
    expect(session).toMatchObject({ tabSwitches: 2, tabSwitchLimit: 3, onHold: true, holdReason: 'TAB_SWITCH_LIMIT' })
    const older = toSession(base) // a server without exam control: safe defaults
    expect(older).toMatchObject({ tabSwitches: 0, tabSwitchLimit: 3, onHold: false, holdReason: null })
  })

  it('shows a locked exam before anything else on the tile', () => {
    expect(tileStatus(toSession({ ...base, on_hold: true, hold_reason: 'ADMIN' }), 'connected')).toEqual({
      label: 'Exam locked',
      tone: 'danger',
    })
    expect(tileStatus(toSession(base), 'connected').label).toBe('Active')
  })
})
