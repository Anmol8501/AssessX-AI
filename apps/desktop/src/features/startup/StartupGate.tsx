import { Navigate } from 'react-router'
import { homeFor, routes } from '@/app/routes'
import { useSession } from '@/features/session'
import { AppLoadingScreen } from './AppLoadingScreen'

/**
 * Root route. Waits for initialisation, then sends the user to the right place:
 * an existing session → that role's dashboard, otherwise → the welcome screen.
 */
export function StartupGate() {
  const { state } = useSession()

  switch (state.status) {
    case 'initializing':
      return <AppLoadingScreen />
    case 'authenticated':
      return <Navigate to={homeFor(state.user.role)} replace />
    case 'anonymous':
      return <Navigate to={routes.welcome} replace />
  }
}
