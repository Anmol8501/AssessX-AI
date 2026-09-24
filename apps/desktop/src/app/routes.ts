import type { Role } from '@/features/session/types'

/** Every navigable path in the application. Keep in sync with app/router.tsx. */
export const routes = {
  root: '/',
  welcome: '/welcome',
  login: '/login',

  admin: {
    root: '/admin',
    dashboard: '/admin',
    assessments: '/admin/assessments',
    assessmentNew: '/admin/assessments/new',
    assessmentDetail: (id: string) => `/admin/assessments/${id}`,
    candidates: '/admin/candidates',
    monitoring: '/admin/monitoring',
    results: '/admin/results',
    assessmentResults: (assessmentId: string) => `/admin/results/${assessmentId}`,
    settings: '/admin/settings',
  },

  candidate: {
    root: '/candidate',
    dashboard: '/candidate',
    exams: '/candidate/exams',
    examDetail: (assessmentId: string) => `/candidate/exams/${assessmentId}`,
    /** The exam itself. Rendered outside the application shell — see app/router.tsx. */
    attempt: (assessmentId: string) => `/candidate/exams/${assessmentId}/attempt`,
    results: '/candidate/results',
    profile: '/candidate/profile',
  },
} as const

/** Landing destination for an authenticated user. */
export function homeFor(role: Role): string {
  return role === 'ADMIN' ? routes.admin.dashboard : routes.candidate.dashboard
}
