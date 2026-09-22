import { useCallback, useEffect, useState } from 'react'
import { useSession, type LoginChallenge } from '@/features/session'
import { ApiError } from '@/lib/api'

type ChallengeState = { challenge: LoginChallenge | null; loading: boolean; error: string | null }

function describe(error: unknown): string {
  return error instanceof ApiError && error.kind === 'network'
    ? 'Cannot reach the AssessX server.'
    : 'Could not load the security check.'
}

/** Loads the sign-in security check and lets the form request a fresh one. */
export function useLoginChallenge() {
  const { challenge: fetchChallenge } = useSession()
  const [state, setState] = useState<ChallengeState>({ challenge: null, loading: true, error: null })

  // Initial fetch — synchronising with the server, so state changes only when the request settles.
  useEffect(() => {
    const controller = new AbortController()
    fetchChallenge()
      .then((challenge) => !controller.signal.aborted && setState({ challenge, loading: false, error: null }))
      .catch((error: unknown) => !controller.signal.aborted && setState({ challenge: null, loading: false, error: describe(error) }))
    return () => controller.abort()
  }, [fetchChallenge])

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      setState({ challenge: await fetchChallenge(), loading: false, error: null })
    } catch (error) {
      setState({ challenge: null, loading: false, error: describe(error) })
    }
  }, [fetchChallenge])

  return { ...state, refresh }
}
