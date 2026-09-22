import { createContext } from 'react'
import type { Credentials, LoginChallenge, SessionState, SessionUser } from './types'

export interface SessionContextValue {
  state: SessionState
  challenge(): Promise<LoginChallenge>
  signIn(credentials: Credentials): Promise<SessionUser>
  signOut(): Promise<void>
  /** Called by data hooks when the API rejects the current token (expired or revoked). */
  expire(): void
}

export const SessionContext = createContext<SessionContextValue | null>(null)
