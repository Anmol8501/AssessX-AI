import { ApiError, apiRequest } from '@/lib/api'
import { tokenStorage } from './tokenStorage'
import type { AuthClient, Credentials, LoginChallenge, Role, SecondFactor, SessionUser, SignedIn } from './types'

/** Wire shapes from `backend/app/schemas`. Kept private; the app works with `SessionUser`. */
interface UserPublicDto {
  id: string
  name: string
  email: string
  role: Role
  is_active: boolean
  roll_number: string | null
  username: string | null
}
interface LoginResponseDto {
  token: string
  token_type: string
  expires_at: string
  user: UserPublicDto
  mfa?: SecondFactor
}
interface MfaStatusDto {
  required: boolean
  enabled: boolean
  verified: boolean
}
interface ChallengeResponseDto {
  challenge_id: string
  image_svg: string
  expires_at: string
}

function toSessionUser(dto: UserPublicDto): SessionUser {
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    role: dto.role,
    isActive: dto.is_active,
    rollNumber: dto.roll_number,
    username: dto.username,
  }
}

/** Real authentication against `/api/v1/auth`. The server decides identity and role. */
export class HttpAuthClient implements AuthClient {
  async restore(): Promise<SignedIn | null> {
    await tokenStorage.load() // a remembered token lives in the OS credential store (desktop app)
    const token = tokenStorage.get()
    if (!token) return null
    try {
      const user = toSessionUser(await apiRequest<UserPublicDto>('/api/v1/auth/me', { token }))
      if (user.role !== 'ADMIN') return { user, mfa: 'none' }
      // An administrator's session may still be waiting for the second factor (e.g. the app was closed).
      const mfa = await apiRequest<MfaStatusDto>('/api/v1/auth/mfa', { token })
      const pending = (mfa.required || mfa.enabled) && !mfa.verified
      return { user, mfa: pending ? (mfa.enabled ? 'required' : 'enroll') : 'none' }
    } catch (error) {
      // A rejected token is dead: forget it. A network failure keeps it for the next launch
      // but the app still starts signed out.
      if (error instanceof ApiError && error.kind === 'http') tokenStorage.clear()
      return null
    }
  }

  async challenge(): Promise<LoginChallenge> {
    const dto = await apiRequest<ChallengeResponseDto>('/api/v1/auth/challenge')
    return { id: dto.challenge_id, imageSvg: dto.image_svg, expiresAt: dto.expires_at }
  }

  async signIn(credentials: Credentials): Promise<SignedIn> {
    const dto =
      credentials.kind === 'candidate'
        ? await apiRequest<LoginResponseDto>('/api/v1/auth/login/candidate', {
            method: 'POST',
            body: {
              roll_number: credentials.rollNumber,
              email: credentials.email,
              password: credentials.password,
              challenge_id: credentials.challengeId,
              challenge_answer: credentials.challengeAnswer,
              remember_me: credentials.remember,
            },
          })
        : await apiRequest<LoginResponseDto>('/api/v1/auth/login/admin', {
            method: 'POST',
            body: {
              username: credentials.username,
              email: credentials.email,
              password: credentials.password,
              challenge_id: credentials.challengeId,
              challenge_answer: credentials.challengeAnswer,
              remember_me: credentials.remember,
            },
          })
    // Administrators are never "remembered" (the server limits their sessions to 12 hours as well).
    tokenStorage.set(dto.token, credentials.remember && credentials.kind === 'candidate')
    return { user: toSessionUser(dto.user), mfa: dto.mfa ?? 'none' }
  }

  async signOut(): Promise<void> {
    const token = tokenStorage.get()
    tokenStorage.clear()
    if (!token) return
    try {
      await apiRequest<void>('/api/v1/auth/logout', { method: 'POST', token })
    } catch {
      // The local session is gone either way; a server-side session that could not be
      // revoked expires on its own.
    }
  }
}
