/**
 * Session model shared by the shell, guards and auth screens.
 *
 * The backend is the only source of a user's role: it is read from the authenticated
 * `/api/v1/auth/me` user, never chosen or stored by the client on its own.
 * Role naming follows the working roadmap (ADMIN / CANDIDATE); the PRD also lists STUDENT — see OQ-03.
 */
export type Role = 'ADMIN' | 'CANDIDATE'

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrator',
  CANDIDATE: 'Candidate',
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
  /** Candidates only. */
  rollNumber: string | null
  /** Administrators only. */
  username: string | null
}

/** The sign-in security check issued by the server. The answer never leaves the server. */
export interface LoginChallenge {
  id: string
  imageSvg: string
  expiresAt: string
}

interface BaseCredentials {
  email: string
  password: string
  /** Server-issued security check and the user's answer. */
  challengeId: string
  challengeAnswer: string
  /** Keep the session across application restarts (longer server-side session). */
  remember: boolean
}

/** Candidates sign in with their university roll number. */
export interface CandidateCredentials extends BaseCredentials {
  kind: 'candidate'
  rollNumber: string
}

/** Administrators sign in with a username. */
export interface AdminCredentials extends BaseCredentials {
  kind: 'admin'
  username: string
}

export type Credentials = CandidateCredentials | AdminCredentials

/**
 * The authentication contract the UI depends on. `HttpAuthClient` implements it against
 * FastAPI; nothing that consumes `useSession()` knows how tokens are stored or sent.
 */
export interface AuthClient {
  /** Restore a previously established session, if one exists and the server still accepts it. */
  restore(): Promise<SessionUser | null>
  /** Fetch a fresh security check for the sign-in form. */
  challenge(): Promise<LoginChallenge>
  signIn(credentials: Credentials): Promise<SessionUser>
  signOut(): Promise<void>
}

/** Why the user is signed out; the login screen turns it into a message. */
export type SignedOutReason = 'expired' | 'signed-out'

export type SessionState =
  | { status: 'initializing' }
  | { status: 'anonymous'; reason?: SignedOutReason }
  | { status: 'authenticated'; user: SessionUser }
