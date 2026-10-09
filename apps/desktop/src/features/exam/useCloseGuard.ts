import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useState } from 'react'

/**
 * While an exam is open, AssessX cannot be closed: the native side refuses a close request (the
 * window's ✕, Alt+F4, the taskbar's "Close window") and says so, and the exam asks the candidate to
 * submit first (`blocked`). The guard is lifted when the exam screen goes away (submitted, ended or
 * expired). A plain browser cannot be kept open, so there it does nothing.
 *
 * Ending AssessX from Task Manager cannot be prevented by an application: the exam then continues on
 * the server's clock, and the candidate can reopen AssessX and carry on.
 */
export function useCloseGuard() {
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: (() => void) | null = null
    void invoke('exam_close_guard', { active: true }).catch(() => undefined)
    void listen('exam://close-blocked', () => setBlocked(true)).then((off) => {
      if (disposed) off()
      else unlisten = off
    })
    return () => {
      disposed = true
      unlisten?.()
      void invoke('exam_close_guard', { active: false }).catch(() => undefined)
    }
  }, [])

  const dismiss = useCallback(() => setBlocked(false), [])
  return { blocked, dismiss }
}
