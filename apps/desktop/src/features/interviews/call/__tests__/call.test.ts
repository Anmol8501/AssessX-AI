import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { EMPTY_INTERVIEW } from '../../types'
import { callSocketUrl, chatText, elapsedSeconds, formatElapsed, hasRelay, MAX_CHAT, mergeMessages, peerMedia, slotAt, SLOTS } from '../callLogic'
import type { ChatMessage } from '../types'

const msg = (id: string, at: string, body = id): ChatMessage => ({
  message_id: id,
  sender: { id: 'u', name: 'U' },
  sender_role: 'CANDIDATE',
  body,
  sent_at: at,
})

describe('live call signaling', () => {
  it('builds the call socket URL from the API base, with the token encoded', () => {
    expect(callSocketUrl('https://api.example.com', 'c1', 'a b+c')).toBe('wss://api.example.com/api/v1/ws/interview-calls/c1?ticket=a%20b%2Bc')
    expect(callSocketUrl('http://127.0.0.1:8000', 'c1', 't')).toBe('ws://127.0.0.1:8000/api/v1/ws/interview-calls/c1?ticket=t')
  })

  it('pre-negotiates microphone, camera and screen in a fixed order', () => {
    expect(SLOTS).toEqual(['audio', 'camera', 'screen'])
    expect([0, 1, 2, 3, -1].map(slotAt)).toEqual(['audio', 'camera', 'screen', null, null])
  })

  it('knows whether the server offers a TURN relay', () => {
    expect(hasRelay([{ urls: ['stun:stun.cloudflare.com:3478'] }])).toBe(false)
    expect(hasRelay([])).toBe(false)
    expect(hasRelay([{ urls: 'stun:a' }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'u', credential: 'c' }])).toBe(true)
    expect(hasRelay([{ urls: 'TURNS:turn.example.com:5349' }])).toBe(true)
  })

  it('reads the peer media flags strictly', () => {
    expect(peerMedia({ audio: true, video: 'yes', screen: 1 })).toEqual({ audio: true, video: false, screen: false })
    expect(peerMedia({})).toEqual({ audio: false, video: false, screen: false })
  })
})

describe('live call chat', () => {
  it('merges messages once each, in sent order', () => {
    const a = msg('a', '2026-10-01T10:00:00Z')
    const b = msg('b', '2026-10-01T10:00:05Z')
    const c = msg('c', '2026-10-01T10:00:02Z')
    const merged = mergeMessages([a, b], [c, a, b])
    expect(merged.map((m) => m.message_id)).toEqual(['a', 'c', 'b'])
    const same = [a]
    expect(mergeMessages(same, [a])).toBe(same) // nothing new: the same array
  })

  it('sends only trimmed, non-empty text within the limit', () => {
    expect(chatText('  hi  ')).toBe('hi')
    expect(chatText('   ')).toBeNull()
    expect(chatText('x'.repeat(MAX_CHAT))).toHaveLength(MAX_CHAT)
    expect(chatText('x'.repeat(MAX_CHAT + 1))).toBeNull()
  })
})

describe('live call timer', () => {
  it('counts from the opening, stops at the end, and never goes negative', () => {
    const opened = '2026-10-01T10:00:00Z'
    expect(elapsedSeconds(opened, Date.parse('2026-10-01T10:01:05.900Z'))).toBe(65)
    expect(elapsedSeconds(opened, Date.parse('2026-10-01T11:00:00Z'), '2026-10-01T10:30:00Z')).toBe(1800)
    expect(elapsedSeconds(opened, Date.parse('2026-10-01T09:59:00Z'))).toBe(0)
  })

  it('formats as m:ss, then h:mm:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65)).toBe('1:05')
    expect(formatElapsed(3600 + 62)).toBe('1:01:02')
    expect(formatElapsed(-5)).toBe('0:00')
  })
})

describe('live interview wiring', () => {
  it('defaults new interviews to the AI format', () => {
    expect(EMPTY_INTERVIEW.format).toBe('AI')
  })

  it('has a call route per side', () => {
    expect(routes.admin.interviewCall('i', 'c')).toBe('/admin/interviews/i/calls/c')
    expect(routes.candidate.interviewCall('i', 'c')).toBe('/candidate/interviews/i/call/c')
  })
})
