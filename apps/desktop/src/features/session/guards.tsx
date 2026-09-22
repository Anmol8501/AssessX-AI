import { Navigate, Outlet } from 'react-router'
import { homeFor, routes } from '@/app/routes'
import { AppLoadingScreen } from '@/features/startup/AppLoadingScreen'
import { useSession } from './useSession'
import type { Role } from './types'

/**
 * Route guards. They read session state only; the backend enforces authorization for real
 * in Phase 1B (TRD §27) — these exist for navigation, not security.
 */

/** Only lets an authenticated user with the given role through. */
export function RequireRole({ role }: { role: Role }) {
  const { state } = useSession()

  switch (state.status) {
    case 'initializing':
      return <AppLoadingScreen />
    case 'anonymous':
      return <Navigate to={routes.login} replace />
    case 'authenticated':
      return state.user.role === role ? <Outlet /> : <Navigate to={homeFor(state.user.role)} replace />
  }
}

/** Entry screens (welcome, login): sends an already-signed-in user to their dashboard. */
export function RequireAnonymous() {
  const { state } = useSession()

  if (state.status === 'initializing') return <AppLoadingScreen />
  if (state.status === 'authenticated') return <Navigate to={homeFor(state.user.role)} replace />
  return <Outlet />
}
