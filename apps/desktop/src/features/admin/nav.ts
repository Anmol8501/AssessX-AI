import { routes } from '@/app/routes'
import type { NavItem } from '@/components/shell/AppShell'
import { AssessmentsIcon, CandidatesIcon, CodeIcon, DashboardIcon, MonitoringIcon, ResultsIcon, ReviewIcon, SettingsIcon, InterviewIcon, ShieldIcon } from '@/components/icons'

export const ADMIN_NAV: readonly NavItem[] = [
  { label: 'Dashboard', to: routes.admin.dashboard, icon: DashboardIcon, end: true },
  { label: 'Assessments', to: routes.admin.assessments, icon: AssessmentsIcon },
  { label: 'Coding Problems', to: routes.admin.codingProblems, icon: CodeIcon },
  { label: 'Candidates', to: routes.admin.candidates, icon: CandidatesIcon },
  { label: 'Monitoring', to: routes.admin.monitoring, icon: MonitoringIcon },
  { label: 'Results', to: routes.admin.results, icon: ResultsIcon },
  { label: 'Reviews', to: routes.admin.reviews, icon: ReviewIcon },
  { label: 'Interviews', to: routes.admin.interviews, icon: InterviewIcon },
  { label: 'Security', to: routes.admin.security, icon: ShieldIcon },
  { label: 'Settings', to: routes.admin.settings, icon: SettingsIcon },
]
