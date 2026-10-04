import { describe, expect, it } from 'vitest'
import { codingDetail, outcomeTone, sectionText } from '@/features/exam/resultText'
import { OUTCOME_LABEL, type QuestionResult } from '@/features/exam/types'
import { hiddenVerdictLabel, LANGUAGE_NAME } from '../types'

const line = (overrides: Partial<QuestionResult> = {}): QuestionResult => ({
  position: 0,
  marks: 10,
  marks_awarded: 7,
  outcome: 'PARTIAL',
  kind: 'CODING',
  tests_passed: 1,
  tests_total: 2,
  verdict: 'WRONG_ANSWER',
  language: 'cpp',
  ...overrides,
})

describe('coding results (stage C4)', () => {
  it('describes a coding question by tests passed, verdict and language — never which tests', () => {
    expect(codingDetail(line())).toBe('1 / 2 tests passed · Wrong answer · C++')
    expect(codingDetail(line({ outcome: 'CORRECT', tests_passed: 2, verdict: 'ACCEPTED', language: 'python' }))).toBe(
      '2 / 2 tests passed · Accepted · Python',
    )
    expect(codingDetail(line({ tests_total: null, tests_passed: null, verdict: null, language: null }))).toBe('No submission')
    expect(codingDetail(line({ verdict: 'SOMETHING_NEW', language: 'rust' }))).toBe('1 / 2 tests passed · SOMETHING_NEW · rust')
  })

  it('says nothing extra for a multiple-choice question', () => {
    expect(codingDetail(line({ kind: 'OBJECTIVE', tests_total: null, verdict: null, language: null }))).toBeNull()
  })

  it('labels and colours a partly correct question', () => {
    expect(OUTCOME_LABEL.PARTIAL).toBe('Partly correct')
    expect(outcomeTone('PARTIAL')).toBe('warn')
    expect(outcomeTone('CORRECT')).toBe('ok')
    expect(outcomeTone('INCORRECT')).toBe('danger')
    expect(outcomeTone('UNANSWERED')).toBe('neutral')
  })

  it('shows a section only when the exam has it', () => {
    expect(sectionText(7, 10)).toBe('7 / 10')
    expect(sectionText(null, 10)).toBe('0 / 10')
    expect(sectionText(null, null)).toBeNull()
  })

  it('labels a hidden test by its verdict alone', () => {
    expect(hiddenVerdictLabel('ACCEPTED')).toBe('Passed')
    expect(hiddenVerdictLabel('WRONG_ANSWER')).toBe('Wrong answer')
    expect(hiddenVerdictLabel('TIME_LIMIT_EXCEEDED')).toBe('Time limit exceeded')
    expect(hiddenVerdictLabel('RUNTIME_ERROR')).toBe('Runtime error')
    expect(hiddenVerdictLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })

  it('names every language the runner supports', () => {
    expect(Object.keys(LANGUAGE_NAME).sort()).toEqual(['c', 'cpp', 'java', 'python'])
  })
})
