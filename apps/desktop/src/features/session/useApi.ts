import { useCallback } from 'react'
import { ApiError, apiRequest } from '@/lib/api'
import { tokenStorage } from './tokenStorage'
import { useSession } from './useSession'

/**
 * Authenticated API access for screens. Sends the stored bearer token and, when the server
 * rejects it (expired / revoked), moves the session to `anonymous` so the guards return the
 * user to sign-in with an explanation — every screen gets that behaviour for free.
 */
export function useApi() {
  const { expire } = useSession()

  return useCallback(
    async <T,>(path: string, options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {}) => {
      try {
        return await apiRequest<T>(path, { ...options, token: tokenStorage.get() })
      } catch (error) {
        if (error instanceof ApiError && error.isUnauthorized) expire()
        throw error
      }
    },
    [expire],
  )
}
