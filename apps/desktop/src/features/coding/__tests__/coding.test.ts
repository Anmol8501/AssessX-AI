import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { allowsCoding, allowsObjective, ASSESSMENT_TYPES, QUESTION_TYPE_LABEL } from '@/features/assessments/types'
import { parseTags, shownVersion, type ProblemSummary, type VersionRef } from '../types'
import { libraryPath } from '../useCoding'

const ref = (version: number, status: VersionRef['status']): VersionRef => ({
  id: `v${version}`,
  version,
  status,
  title: `T${version}`,
  difficulty: 'EASY',
  tags: [],
  languages: ['python'],
  published_at: status === 'PUBLISHED' ? '2026-10-02T00:00:00Z' : null,
})

describe('assessment types (the UI mirrors the server rule)', () => {
  it('offers MCQ only, Coding only and Mixed, with the agreed descriptions', () => {
    expect(ASSESSMENT_TYPES.map((t) => [t.value, t.label])).toEqual([
      ['MCQ', 'MCQ only'],
      ['CODING', 'Coding only'],
      ['MIXED', 'Mixed'],
    ])
    expect(ASSESSMENT_TYPES[1]!.description).toBe('Programming and coding assessment.')
  })

  it('decides which question types can be added', () => {
    expect([allowsObjective('MCQ'), allowsCoding('MCQ')]).toEqual([true, false])
    expect([allowsObjective('CODING'), allowsCoding('CODING')]).toEqual([false, true])
    expect([allowsObjective('MIXED'), allowsCoding('MIXED')]).toEqual([true, true])
    expect(QUESTION_TYPE_LABEL.CODING).toBe('Coding problem')
  })
})

describe('coding library helpers', () => {
  it('parses tags: trimmed, de-duplicated without regard to case', () => {
    expect(parseTags(' Arrays, arrays ,Hashing,, ')).toEqual(['Arrays', 'Hashing'])
    expect(parseTags('')).toEqual([])
  })

  it('shows the open draft first, else the latest published version', () => {
    const base: ProblemSummary = { id: 'p', slug: 's', is_enabled: true, created_at: '', created_by: 'A', latest: null, draft: null, used_in: 0 }
    expect(shownVersion({ ...base, latest: ref(1, 'PUBLISHED'), draft: ref(2, 'DRAFT') })?.version).toBe(2)
    expect(shownVersion({ ...base, latest: ref(1, 'PUBLISHED') })?.version).toBe(1)
    expect(shownVersion(base)).toBeNull()
  })

  it('builds the library query from the filters, leaving out empty ones', () => {
    expect(libraryPath()).toBe('/api/v1/coding-problems')
    expect(libraryPath({ search: '  two sum ', difficulty: '', tag: 'Hashing', publishedOnly: true, enabledOnly: true })).toBe(
      '/api/v1/coding-problems?search=two+sum&tag=Hashing&published_only=true&enabled_only=true',
    )
  })

  it('has admin routes for the library', () => {
    expect(routes.admin.codingProblems).toBe('/admin/coding-problems')
    expect(routes.admin.codingProblem('p1')).toBe('/admin/coding-problems/p1')
  })
})
