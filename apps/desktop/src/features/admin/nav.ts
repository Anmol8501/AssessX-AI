import { routes } from '@/app/routes'
import type { NavItem } from '@/components/shell/AppShell'
import { AssessmentsIcon, CandidatesIcon, DashboardIcon, MonitoringIcon, ResultsIcon, SettingsIcon } from '@/components/icons'

export const ADMIN_NAV: readonly NavItem[] = [
  { label: 'Dashboard', to: routes.admin.dashboard, icon: DashboardIcon, end: true },
  { label: 'Assessments', to: routes.admin.assessments, icon: AssessmentsIcon },
  { label: 'Candidates', to: routes.admin.candidates, icon: CandidatesIcon },
  { label: 'Monitoring', to: routes.admin.monitoring, icon: MonitoringIcon },
  { label: 'Results', to: routes.admin.results, icon: ResultsIcon },
  { label: 'Settings', to: routes.admin.settings, icon: SettingsIcon },
]
