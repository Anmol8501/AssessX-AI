import { ApiError, apiRequest } from '@/lib/api'
import { tokenStorage } from './tokenStorage'
import type { AuthClient, Credentials, LoginChallenge, Role, SessionUser } from './types'

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
  async restore(): Promise<SessionUser | null> {
    const token = tokenStorage.get()
    if (!token) return null
    try {
      return toSessionUser(await apiRequest<UserPublicDto>('/api/v1/auth/me', { token }))
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

  async signIn(credentials: Credentials): Promise<SessionUser> {
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
    tokenStorage.set(dto.token, credentials.remember)
    return toSessionUser(dto.user)
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
