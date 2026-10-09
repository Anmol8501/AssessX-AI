import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { SessionContext, type SessionContextValue } from './SessionContext'
import { clearExamLocalData } from '@/lib/localData'
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
      .then((signed) => {
        if (cancelled) return
        if (!signed) setState({ status: 'anonymous' })
        else if (signed.mfa === 'none') setState({ status: 'authenticated', user: signed.user })
        else setState({ status: 'second-factor', user: signed.user, mfa: signed.mfa })
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
      const signed = await client.signIn(credentials)
      setState(
        signed.mfa === 'none'
          ? { status: 'authenticated', user: signed.user }
          : { status: 'second-factor', user: signed.user, mfa: signed.mfa },
      )
      return signed
    },
    [client],
  )

  const signOut = useCallback(async () => {
    await client.signOut()
    // A deliberate sign-out: nothing of this user's exams stays on the machine (Phase 8B, BX-12).
    clearExamLocalData()
    setState({ status: 'anonymous', reason: 'signed-out' })
  }, [client])

  const expire = useCallback(() => {
    tokenStorage.clear()
    setState((current) =>
      current.status === 'authenticated' || current.status === 'second-factor' ? { status: 'anonymous', reason: 'expired' } : current,
    )
  }, [])

  const completeSecondFactor = useCallback(() => {
    setState((current) => (current.status === 'second-factor' ? { status: 'authenticated', user: current.user } : current))
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({ state, challenge, signIn, signOut, expire, completeSecondFactor }),
    [state, challenge, signIn, signOut, expire, completeSecondFactor],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
