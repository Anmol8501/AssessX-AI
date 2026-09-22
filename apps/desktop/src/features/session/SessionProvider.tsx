import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SessionContext, type SessionContextValue } from './SessionContext'
import { tokenStorage } from './tokenStorage'
import type { AuthClient, Credentials, SessionState } from './types'

interface SessionProviderProps {
  client: AuthClient
  children: ReactNode
}

/**
 * The single owner of authentication state. Runs the startup check
 * (`initializing` → restore → `anonymous` | `authenticated`) once, exposes sign-in / sign-out
 * to the auth screens, and lets data hooks report an expired session. Route guards read
 * `state`; nothing else keeps its own copy.
 */
export function SessionProvider({ client, children }: SessionProviderProps) {
  const [state, setState] = useState<SessionState>({ status: 'initializing' })

  useEffect(() => {
    let cancelled = false
    client
      .restore()
      .then((user) => {
        if (cancelled) return
        setState(user ? { status: 'authenticated', user } : { status: 'anonymous' })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'anonymous' })
      })
    return () => {
      cancelled = true
    }
  }, [client])

  const challenge = useCallback(() => client.challenge(), [client])

  const signIn = useCallback(
    async (credentials: Credentials) => {
      const user = await client.signIn(credentials)
      setState({ status: 'authenticated', user })
      return user
    },
    [client],
  )

  const signOut = useCallback(async () => {
    await client.signOut()
    setState({ status: 'anonymous', reason: 'signed-out' })
  }, [client])

  const expire = useCallback(() => {
    tokenStorage.clear()
    setState((current) => (current.status === 'authenticated' ? { status: 'anonymous', reason: 'expired' } : current))
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({ state, challenge, signIn, signOut, expire }),
    [state, challenge, signIn, signOut, expire],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
