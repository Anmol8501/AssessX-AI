import { useContext } from 'react'
import { SessionContext, type SessionContextValue } from './SessionContext'
import type { SessionUser } from './types'

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error('useSession must be used within <SessionProvider>.')
  }
  return ctx
}

/** Convenience for screens that are only rendered behind a `RequireRole` guard. */
export function useCurrentUser(): SessionUser {
  const { state } = useSession()
  if (state.status !== 'authenticated') {
    throw new Error('useCurrentUser called outside an authenticated route.')
  }
  return state.user
}
