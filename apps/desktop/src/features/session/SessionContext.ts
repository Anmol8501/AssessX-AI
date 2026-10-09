import { createContext } from 'react'
import type { Credentials, LoginChallenge, SessionState, SignedIn } from './types'

export interface SessionContextValue {
  state: SessionState
  challenge(): Promise<LoginChallenge>
  signIn(credentials: Credentials): Promise<SignedIn>
  /** The administrator passed (or set up) the second factor: the sign-in is complete. */
  completeSecondFactor(): void
  signOut(): Promise<void>
  /** Called by data hooks when the API rejects the current token (expired or revoked). */
  expire(): void
}

export const SessionContext = createContext<SessionContextValue | null>(null)
