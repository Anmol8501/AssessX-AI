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
    reviews: '/admin/reviews',
    interviews: '/admin/interviews',
    interviewDetail: (id: string) => `/admin/interviews/${id}`,
    interviewReports: '/admin/interviews/reports',
    interviewReport: (interviewId: string, sessionId: string) => `/admin/interviews/${interviewId}/sessions/${sessionId}`,
    /** A live interview call (Phase 7D). Rendered outside the application shell — see app/router.tsx. */
    interviewCall: (interviewId: string, callId: string) => `/admin/interviews/${interviewId}/calls/${callId}`,
    review: (attemptId: string) => `/admin/reviews/${attemptId}`,
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
    interviews: '/candidate/interviews',
    interviewDetail: (interviewId: string) => `/candidate/interviews/${interviewId}`,
    /** The interview itself. Rendered outside the application shell, like the exam. */
    interviewSession: (interviewId: string) => `/candidate/interviews/${interviewId}/session`,
    /** A live interview call (Phase 7D), full-screen like the interview itself. */
    interviewCall: (interviewId: string, callId: string) => `/candidate/interviews/${interviewId}/call/${callId}`,
    profile: '/candidate/profile',
  },
} as const

/** Landing destination for an authenticated user. */
export function homeFor(role: Role): string {
  return role === 'ADMIN' ? routes.admin.dashboard : routes.candidate.dashboard
}
