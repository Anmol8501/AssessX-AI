import { describe, expect, it } from 'vitest'
import { routes } from '@/app/routes'
import { isExamRoute } from '../policy'

describe('isExamRoute — an update is never offered on the exam screen', () => {
  it('recognises the exam screen, however its URL is decorated', () => {
    const attempt = routes.candidate.attempt('3f1c2a9e-0000-4000-8000-000000000001')
    expect(isExamRoute(`#${attempt}`)).toBe(true)
    expect(isExamRoute(`#${attempt}/`)).toBe(true)
    expect(isExamRoute(`#${attempt}?q=2`)).toBe(true)
  })

  it.each([
    '',
    '#/',
    '#/welcome',
    '#/login',
    '#/candidate',
    '#/candidate/exams',
    '#/candidate/exams/3f1c2a9e-0000-4000-8000-000000000001',
    '#/admin/monitoring',
    '#/admin/assessments/3f1c2a9e/attempts',
  ])('allows the prompt on %s', (hash) => {
    expect(isExamRoute(hash)).toBe(false)
  })
})
