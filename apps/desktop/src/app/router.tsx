import { createHashRouter, Navigate } from 'react-router'
import { AdminShell } from '@/features/admin/AdminShell'
import { AdminDashboardPage } from '@/features/admin/pages/AdminDashboardPage'
import { AdminResultsPage } from '@/features/admin/pages/AdminResultsPage'
import { AssessmentResultsPage } from '@/features/admin/pages/AssessmentResultsPage'
import { AssessmentBuilderPage } from '@/features/assessments/pages/AssessmentBuilderPage'
import { AssessmentsPage } from '@/features/assessments/pages/AssessmentsPage'
import { CreateAssessmentPage } from '@/features/assessments/pages/CreateAssessmentPage'
import { CandidatesPage } from '@/features/admin/pages/CandidatesPage'
import { MonitoringPage } from '@/features/admin/pages/MonitoringPage'
import { SettingsPage } from '@/features/admin/pages/SettingsPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { CandidateShell } from '@/features/candidate/CandidateShell'
import { ExamAttemptPage } from '@/features/exam/pages/ExamAttemptPage'
import { ExamDetailsPage } from '@/features/exam/pages/ExamDetailsPage'
import { CandidateDashboardPage } from '@/features/candidate/pages/CandidateDashboardPage'
import { CandidateResultsPage } from '@/features/candidate/pages/CandidateResultsPage'
import { MyExamsPage } from '@/features/candidate/pages/MyExamsPage'
import { ProfilePage } from '@/features/candidate/pages/ProfilePage'
import { RequireAnonymous, RequireRole } from '@/features/session'
import { StartupGate } from '@/features/startup/StartupGate'
import { WelcomePage } from '@/features/startup/WelcomePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { RouteErrorBoundary } from './RouteErrorBoundary'
import { routes } from './routes'

/**
 * Hash-based history: works identically in the Vite dev server and inside the Tauri
 * webview, where there is no server to rewrite deep links to index.html.
 */
export const router = createHashRouter([
  {
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: routes.root, element: <StartupGate /> },

      // Entry screens — an authenticated user is redirected to their dashboard.
      {
        element: <RequireAnonymous />,
        children: [
          { path: routes.welcome, element: <WelcomePage /> },
          { path: routes.login, element: <LoginPage /> },
        ],
      },

      {
        element: <RequireRole role="ADMIN" />,
        children: [
          {
            path: routes.admin.root,
            element: <AdminShell />,
            children: [
              { index: true, element: <AdminDashboardPage /> },
              { path: 'assessments', element: <AssessmentsPage /> },
              { path: 'assessments/new', element: <CreateAssessmentPage /> },
              { path: 'assessments/:assessmentId', element: <AssessmentBuilderPage /> },
              { path: 'candidates', element: <CandidatesPage /> },
              { path: 'monitoring', element: <MonitoringPage /> },
              { path: 'results', element: <AdminResultsPage /> },
              { path: 'results/:assessmentId', element: <AssessmentResultsPage /> },
              { path: 'settings', element: <SettingsPage /> },
              { path: '*', element: <Navigate to={routes.admin.dashboard} replace /> },
            ],
          },
        ],
      },

      {
        element: <RequireRole role="CANDIDATE" />,
        children: [
          // The exam runs outside the shell: no sidebar and no navigation while answering.
          // Listed first, and more specific than the shell's catch-all child, so it wins the match.
          { path: routes.candidate.attempt(':assessmentId'), element: <ExamAttemptPage /> },
          {
            path: routes.candidate.root,
            element: <CandidateShell />,
            children: [
              { index: true, element: <CandidateDashboardPage /> },
              { path: 'exams', element: <MyExamsPage /> },
              { path: 'exams/:assessmentId', element: <ExamDetailsPage /> },
              { path: 'results', element: <CandidateResultsPage /> },
              { path: 'profile', element: <ProfilePage /> },
              { path: '*', element: <Navigate to={routes.candidate.dashboard} replace /> },
            ],
          },
        ],
      },

      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
