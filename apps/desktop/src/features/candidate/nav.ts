import { routes } from '@/app/routes'
import type { NavItem } from '@/components/shell/AppShell'
import { DashboardIcon, ExamsIcon, ProfileIcon, ResultsIcon } from '@/components/icons'

export const CANDIDATE_NAV: readonly NavItem[] = [
  { label: 'Dashboard', to: routes.candidate.dashboard, icon: DashboardIcon, end: true },
  { label: 'My Exams', to: routes.candidate.exams, icon: ExamsIcon },
  { label: 'Results', to: routes.candidate.results, icon: ResultsIcon },
  { label: 'Profile', to: routes.candidate.profile, icon: ProfileIcon },
]
