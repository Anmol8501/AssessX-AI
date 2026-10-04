import { afterEach, describe, expect, it, vi } from 'vitest'
import { isAnswered } from '@/features/exam/answered'
import type { CandidateQuestion } from '@/features/exam/types'
import { classifyKey } from '@/features/proctoring/environment/restrictions'
import { CODING_STATUS_LABEL, draftKey, initialCode, isFinished, newRequestKey, questionLabels, readLocalDraft, shortLabel, writeLocalDraft } from '../candidate/codingLogic'

const q = (id: string, type: string): CandidateQuestion => ({ id, type: type as CandidateQuestion['type'], text: id, marks: 1, position: 0, options: [] })

describe('question labels follow the assessment type', () => {
  it('MCQ only: Question n', () => {
    expect(questionLabels([q('a', 'MCQ'), q('b', 'TRUE_FALSE')], 'MCQ')).toEqual(['Question 1', 'Question 2'])
  })

  it('coding only: Problem n', () => {
    expect(questionLabels([q('a', 'CODING'), q('b', 'CODING')], 'CODING')).toEqual(['Problem 1', 'Problem 2'])
  })

  it('mixed: questions keep their position, coding problems are counted on their own', () => {
    const labels = questionLabels([q('a', 'MCQ'), q('b', 'MCQ'), q('c', 'CODING'), q('d', 'MCQ'), q('e', 'CODING')], 'MIXED')
    expect(labels).toEqual(['Question 1', 'Question 2', 'Coding 1', 'Question 4', 'Coding 2'])
    expect(labels.map(shortLabel)).toEqual(['1', '2', 'C1', '4', 'C2'])
  })

  it('names every coding status in plain words, never a score', () => {
    expect(Object.values(CODING_STATUS_LABEL)).toEqual(['Not started', 'In progress', 'Being checked', 'Passed', 'Not all tests passed'])
  })
})

describe('which code the page opens with', () => {
  const starters = { python: 'def solve(): pass\n', java: 'class Main {}' }

  it('the starter code for the first language when nothing is saved', () => {
    expect(initialCode(null, null, starters, ['python', 'java'])).toEqual({ language: 'python', source: starters.python, revision: 0, unsaved: false })
  })

  it("the server's draft when it is the newest", () => {
    const server = { language: 'java', source: 'class Main { /* mine */ }', revision: 3 }
    expect(initialCode(server, { language: 'java', source: 'older', revision: 2, savedAt: 1 }, starters, ['python', 'java'])).toEqual({ ...server, unsaved: false })
  })

  it('the local backup when it holds edits the server has not seen (e.g. made offline)', () => {
    const server = { language: 'python', source: 'print(1)', revision: 3 }
    const local = { language: 'python', source: 'print(2)', revision: 3, savedAt: 1 }
    expect(initialCode(server, local, starters, ['python'])).toEqual({ language: 'python', source: 'print(2)', revision: 3, unsaved: true })
  })

  it('never a language the problem does not allow', () => {
    expect(initialCode({ language: 'cpp', source: 'x', revision: 1 }, null, starters, ['python']).language).toBe('python')
  })
})

describe('the local backup', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is kept per attempt and question, and survives a broken value', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    writeLocalDraft('att', 'q1', { language: 'python', source: 'print(1)', revision: 2, savedAt: 5 })
    expect(readLocalDraft('att', 'q1')?.source).toBe('print(1)')
    expect(readLocalDraft('att', 'q2')).toBeNull()
    store.set(draftKey('att', 'q3'), '{not json')
    expect(readLocalDraft('att', 'q3')).toBeNull()
  })

  it('never throws when storage is unavailable', () => {
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(() => writeLocalDraft('att', 'q1', { language: 'python', source: 'x', revision: 0, savedAt: 0 })).not.toThrow()
    expect(readLocalDraft('att', 'q1')).toBeNull()
  })
})

describe('requests and answers', () => {
  it('makes a fresh, server-acceptable idempotency key each time', () => {
    const a = newRequestKey()
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    expect(newRequestKey()).not.toBe(a)
    expect([isFinished('COMPLETED'), isFinished('FAILED'), isFinished('RUNNING')]).toEqual([true, true, false])
  })

  it('counts a coding problem as answered once it has a submission', () => {
    const coding = q('c', 'CODING')
    expect(isAnswered(coding, {}, { c: 'IN_PROGRESS' })).toBe(false)
    expect(isAnswered(coding, {}, { c: 'NOT_PASSED' })).toBe(true)
    expect(isAnswered(q('m', 'MCQ'), { m: ['opt'] })).toBe(true)
  })
})

describe('keyboard restrictions in the code editor', () => {
  const key = (k: string, extra: Partial<KeyboardEventInit> = {}) => ({ key: k, code: `Key${k.toUpperCase()}`, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, ...extra })

  it("allows the editor's own find shortcuts there, and only there", () => {
    const inside = { closest: (selector: string) => (selector === '.cm-editor' ? {} : null) } as unknown as EventTarget
    const outside = { closest: () => null } as unknown as EventTarget
    expect(classifyKey(key('f'), inside)).toBeNull()
    expect(classifyKey(key('f'), outside)?.eventType).toBe('KEYBOARD_RESTRICTION_ATTEMPT')
    // Copy and paste stay restricted inside the editor too.
    expect(classifyKey(key('v'), inside)?.eventType).toBe('PASTE_ATTEMPT')
    expect(classifyKey(key('c'), inside)?.eventType).toBe('COPY_ATTEMPT')
  })
})
