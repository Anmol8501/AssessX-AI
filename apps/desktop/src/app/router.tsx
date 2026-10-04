import { createHashRouter, Navigate } from 'react-router'
import { AdminShell } from '@/features/admin/AdminShell'
import { AdminDashboardPage } from '@/features/admin/pages/AdminDashboardPage'
import { AdminResultsPage } from '@/features/admin/pages/AdminResultsPage'
import { AssessmentResultsPage } from '@/features/admin/pages/AssessmentResultsPage'
import { AssessmentBuilderPage } from '@/features/assessments/pages/AssessmentBuilderPage'
import { AssessmentsPage } from '@/features/assessments/pages/AssessmentsPage'
import { CreateAssessmentPage } from '@/features/assessments/pages/CreateAssessmentPage'
import { CodingProblemPage } from '@/features/coding/admin/CodingProblemPage'
import { CodingProblemsPage } from '@/features/coding/admin/CodingProblemsPage'
import { CandidatesPage } from '@/features/admin/pages/CandidatesPage'
import { LiveMonitoringPage } from '@/features/admin/monitoring/LiveMonitoringPage'
import { SettingsPage } from '@/features/admin/pages/SettingsPage'
import { AttemptReviewPage } from '@/features/admin/review/AttemptReviewPage'
import { ReviewQueuePage } from '@/features/admin/review/ReviewQueuePage'
import { InterviewEditorPage } from '@/features/interviews/admin/InterviewEditorPage'
import { AdminCallPage } from '@/features/interviews/call/AdminCallPage'
import { CandidateCallPage } from '@/features/interviews/call/CandidateCallPage'
import { InterviewsPage } from '@/features/interviews/admin/InterviewsPage'
import { InterviewDetailsPage } from '@/features/interviews/candidate/InterviewDetailsPage'
import { InterviewRunnerPage } from '@/features/interviews/candidate/InterviewRunnerPage'
import { MyInterviewsPage } from '@/features/interviews/candidate/MyInterviewsPage'
import { InterviewReportPage } from '@/features/interviews/report/InterviewReportPage'
import { ReportQueuePage } from '@/features/interviews/report/ReportQueuePage'
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
          // A live interview call is full-screen: the video needs the room, and the shell's navigation
          // would only lead away from it. More specific than the shell's catch-all child, so it wins.
          { path: routes.admin.interviewCall(':interviewId', ':callId'), element: <AdminCallPage /> },
          {
            path: routes.admin.root,
            element: <AdminShell />,
            children: [
              { index: true, element: <AdminDashboardPage /> },
              { path: 'assessments', element: <AssessmentsPage /> },
              { path: 'assessments/new', element: <CreateAssessmentPage /> },
              { path: 'assessments/:assessmentId', element: <AssessmentBuilderPage /> },
              { path: 'coding-problems', element: <CodingProblemsPage /> },
              { path: 'coding-problems/:problemId', element: <CodingProblemPage /> },
              { path: 'candidates', element: <CandidatesPage /> },
              { path: 'monitoring', element: <LiveMonitoringPage /> },
              { path: 'results', element: <AdminResultsPage /> },
              { path: 'results/:assessmentId', element: <AssessmentResultsPage /> },
              { path: 'reviews', element: <ReviewQueuePage /> },
              { path: 'reviews/:attemptId', element: <AttemptReviewPage /> },
              { path: 'interviews', element: <InterviewsPage /> },
              { path: 'interviews/reports', element: <ReportQueuePage /> },
              { path: 'interviews/:interviewId/sessions/:sessionId', element: <InterviewReportPage /> },
              { path: 'interviews/:interviewId', element: <InterviewEditorPage /> },
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
          { path: routes.candidate.interviewSession(':interviewId'), element: <InterviewRunnerPage /> },
          { path: routes.candidate.interviewCall(':interviewId', ':callId'), element: <CandidateCallPage /> },
          {
            path: routes.candidate.root,
            element: <CandidateShell />,
            children: [
              { index: true, element: <CandidateDashboardPage /> },
              { path: 'exams', element: <MyExamsPage /> },
              { path: 'exams/:assessmentId', element: <ExamDetailsPage /> },
              { path: 'results', element: <CandidateResultsPage /> },
              { path: 'interviews', element: <MyInterviewsPage /> },
              { path: 'interviews/:interviewId', element: <InterviewDetailsPage /> },
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
