import { useCallback, useEffect, useRef, useState } from 'react'
import type { AttemptControl, AttemptSession, ProctorMessage } from '@/features/exam/types'
import { useApi } from '@/features/session'

const ME = '/api/v1/candidates/me'
/** While the exam is on hold, how often the app checks whether it was released (if a push is missed). */
const HOLD_POLL_MS = 5000
/** After a long absence, when to re-read the count (once the event reporter has delivered the return). */
const AFTER_RETURN_MS = 2500
/** After a short absence, when to re-read: a brief switch to another app now counts too. */
const AFTER_SHORT_RETURN_MS = 1200
/** Matches the server's grace period for absences it cannot classify. */
const GRACE_MS = 2000

/** Window events: the live push from the proctoring socket, and "please re-check" from the exam. */
export const CONTROL_EVENT = 'assessx:attempt-control'
export const CONTROL_REFRESH_EVENT = 'assessx:attempt-control-refresh'

export interface TabSwitchWarning {
  /** 1 for the first warning, 2 for the second. */
  number: number
  /** How many warnings the rule allows before the exam is locked (tab_switch_limit - 1). */
  allowed: number
}

const EMPTY: AttemptControl = {
  tab_switches: 0,
  tab_switch_limit: 3,
  on_hold: false,
  hold_reason: null,
  held_at: null,
  ended_by_admin: false,
  messages: [],
}

/**
 * Exam control as the candidate's app sees it: the server's tab-switch count and whether the exam is
 * on hold (locked). The server decides both; this hook only follows it.
 *
 * Three ways it learns of a change, so a missed one never leaves the screen wrong: the live push on
 * the proctoring socket (`ATTEMPT_CONTROL`), a re-read shortly after the candidate returns from a long
 * absence, and — while on hold — a re-read every few seconds until released.
 *
 * `warning` is set when the count goes up without a hold (the first and second switches), for the
 * screen to show once; `dismissWarning` clears it.
 */
export function useAttemptControl(attemptId: string, initial: AttemptControl | null | undefined) {
  const api = useApi()
  const [control, setControl] = useState<AttemptControl>(initial ?? EMPTY)
  const [warning, setWarning] = useState<TabSwitchWarning | null>(null)
  const seen = useRef((initial ?? EMPTY).tab_switches)

  const apply = useCallback((next: AttemptControl) => {
    setControl(next)
    if (next.tab_switches > seen.current && !next.on_hold) {
      setWarning({ number: next.tab_switches, allowed: next.tab_switch_limit - 1 })
    }
    if (next.on_hold) setWarning(null)
    seen.current = Math.max(seen.current, next.tab_switches)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const session = await api<AttemptSession>(`${ME}/attempts/${attemptId}/session`)
      if (session.control) apply(session.control)
    } catch {
      // The next push, poll or return re-reads it.
    }
  }, [api, attemptId, apply])

  // The live push, and "re-check" requests from the exam (a save refused because the exam is on hold).
  useEffect(() => {
    const onControl = (event: Event) => {
      const detail = (event as CustomEvent<AttemptControl & { attempt_id?: string }>).detail
      if (detail && (!detail.attempt_id || detail.attempt_id === attemptId)) apply(detail)
    }
    const onRefresh = () => void refresh()
    window.addEventListener(CONTROL_EVENT, onControl)
    window.addEventListener(CONTROL_REFRESH_EVENT, onRefresh)
    return () => {
      window.removeEventListener(CONTROL_EVENT, onControl)
      window.removeEventListener(CONTROL_REFRESH_EVENT, onRefresh)
    }
  }, [attemptId, apply, refresh])

  // After a long absence, re-read once the return has reached the server.
  useEffect(() => {
    let leftAt: number | null = null
    let timer: number | null = null
    const onBlur = () => {
      leftAt ??= Date.now()
    }
    const onFocus = () => {
      if (leftAt !== null) {
        // Every return is re-read: a departure to another app counts however short it was.
        if (timer !== null) window.clearTimeout(timer)
        const wait = Date.now() - leftAt > GRACE_MS ? AFTER_RETURN_MS : AFTER_SHORT_RETURN_MS
        timer = window.setTimeout(() => void refresh(), wait)
      }
      leftAt = null
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [refresh])

  // While on hold, look again every few seconds until released.
  useEffect(() => {
    if (!control.on_hold) return
    const timer = window.setInterval(() => void refresh(), HOLD_POLL_MS)
    return () => window.clearInterval(timer)
  }, [control.on_hold, refresh])

  const dismissWarning = useCallback(() => setWarning(null), [])

  /** The candidate read a proctor's message: hide it now, tell the server (it shows the proctor "Seen"). */
  const acknowledge = useCallback(
    async (message: ProctorMessage) => {
      setControl((current) => ({ ...current, messages: (current.messages ?? []).filter((m) => m.id !== message.id) }))
      try {
        const next = await api<AttemptControl>(`${ME}/attempts/${attemptId}/messages/${message.id}/acknowledge`, { method: 'POST' })
        apply(next)
      } catch {
        // Not delivered: the next read shows it again, so the candidate can confirm once more.
      }
    },
    [api, attemptId, apply],
  )
  return { control, warning, dismissWarning, acknowledge }
}
