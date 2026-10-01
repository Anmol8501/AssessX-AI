import { afterEach, describe, expect, it, vi } from 'vitest'
import { completionLabel, interviewStatusLabel, sessionStatusLabel } from '../labels'
import { EMPTY_INTERVIEW, orderQuestions, parseList, type InterviewQuestion } from '../types'
import { drafts } from '../useInterviewSession'

const q = (id: string, position: number, extra: Partial<InterviewQuestion> = {}): InterviewQuestion => ({
  id,
  kind: 'PRIMARY',
  parent_question_id: null,
  text: id,
  question_type: 'TECHNICAL',
  topic: 'Python',
  difficulty: 'EASY',
  expected_concepts: [],
  competency: null,
  context: null,
  time_limit_seconds: null,
  position,
  is_active: true,
  ...extra,
})

describe('interview question list', () => {
  it('orders primaries by position and pairs each with its follow-up', () => {
    const rows = orderQuestions([
      q('b', 1),
      q('fa', 0, { kind: 'FOLLOW_UP', parent_question_id: 'a' }),
      q('c', 2),
      q('a', 0),
    ])
    expect(rows.map((r) => [r.primary.id, r.followUp?.id ?? null])).toEqual([
      ['a', 'fa'],
      ['b', null],
      ['c', null],
    ])
  })

  it('parses topics and concepts: trimmed, de-duplicated case-insensitively, order kept', () => {
    expect(parseList(' Python, SQL,\npython , , Data Structures ')).toEqual(['Python', 'SQL', 'Data Structures'])
    expect(parseList('')).toEqual([])
  })
})

describe('interview labels', () => {
  it('describe state, never a judgement of the candidate', () => {
    const texts = [
      ...(['NOT_STARTED', 'ACTIVE', 'COMPLETED'] as const).map((s) => sessionStatusLabel(s).label),
      ...(['ALL_ANSWERED', 'TIME_EXPIRED', 'ENDED_BY_CANDIDATE'] as const).map((r) => completionLabel(r)),
      ...(['DRAFT', 'PUBLISHED'] as const).map((s) => interviewStatusLabel(s).label),
    ]
    for (const text of texts) expect(text).not.toMatch(/score|pass|fail|hire|reject|good|poor|strong|weak/i)
    expect(completionLabel(null)).toBe('')
  })
})

describe('answer drafts', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keep typing per question across a refresh, and clear when saved', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    drafts.write('item-1', 'half an answer')
    expect(drafts.read('item-1')).toBe('half an answer')
    expect(drafts.read('item-2')).toBe('')
    drafts.write('item-1', '')
    expect(drafts.read('item-1')).toBe('')
  })

  it('fail safe when storage is unavailable (a private window, a blocked store)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    expect(() => drafts.write('item-1', 'text')).not.toThrow()
    expect(drafts.read('item-1')).toBe('')
  })
})

describe('adaptive interview defaults (Phase 7B)', () => {
  it('start non-adaptive with consistent difficulty bounds', () => {
    const rank = { EASY: 1, MEDIUM: 2, HARD: 3 } as const
    expect(EMPTY_INTERVIEW.adaptive_difficulty).toBe(false)
    expect(rank[EMPTY_INTERVIEW.min_difficulty]).toBeLessThanOrEqual(rank[EMPTY_INTERVIEW.starting_difficulty])
    expect(rank[EMPTY_INTERVIEW.starting_difficulty]).toBeLessThanOrEqual(rank[EMPTY_INTERVIEW.difficulty])
  })
})
