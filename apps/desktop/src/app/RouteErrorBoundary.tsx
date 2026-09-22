import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router'
import { ErrorState } from '@/components/ui'
import { NotFoundPage } from '@/pages/NotFoundPage'

/** Catches render/loader errors below a route so a bug shows a recoverable screen, not a blank window. */
export function RouteErrorBoundary() {
  const error = useRouteError()
  const navigate = useNavigate()

  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundPage />
  }

  if (import.meta.env.DEV) {
    console.error(error)
  }

  return (
    <div className="bg-surface h-full w-full">
      <ErrorState layout="page" onRetry={() => navigate(0)} />
    </div>
  )
}
