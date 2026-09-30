import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { Button } from '@/components/ui'
import { APP_VERSION } from '@/config/app'
import { FIRST_CHECK_DELAY_MS, RECHECK_INTERVAL_MS, isExamRoute } from './policy'

type Phase =
  | { kind: 'idle' }
  | { kind: 'available'; update: Update }
  | { kind: 'downloading'; update: Update; percent: number | null }
  | { kind: 'installing'; update: Update }
  | { kind: 'error'; update: Update; message: string }

/**
 * In-app updates for the installed desktop app.
 *
 * Shortly after start-up (and every few hours while open) the app asks the latest GitHub Release
 * for its `latest.json`. When a newer version exists it offers "Update now / Later"; "Update now"
 * downloads the installer, which the updater plugin installs only if its signature matches the
 * public key built into this app (so only builds signed with the AssessX release key can be
 * installed), then restarts the app.
 *
 * It never appears on the exam screen — installing closes the app — and while an update is being
 * downloaded or installed it blocks the window, so an exam cannot be started mid-update. Failing to
 * *check* (offline, no release yet) is silent; failing to *install* is shown, with a retry.
 * Outside the desktop app (development in a browser, the E2E suite) it does nothing.
 */
export function UpdatePrompt() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [onExamScreen, setOnExamScreen] = useState(() => isExamRoute(window.location.hash))

  useEffect(() => {
    const onRoute = () => setOnExamScreen(isExamRoute(window.location.hash))
    window.addEventListener('hashchange', onRoute)
    return () => window.removeEventListener('hashchange', onRoute)
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const run = async () => {
      try {
        const update = await check()
        if (!cancelled && update) {
          setPhase((current) => (current.kind === 'idle' || current.kind === 'available' ? { kind: 'available', update } : current))
        }
      } catch {
        // Offline, GitHub unreachable, or no release published yet: try again later, quietly.
      }
    }
    const first = window.setTimeout(run, FIRST_CHECK_DELAY_MS)
    const again = window.setInterval(run, RECHECK_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(first)
      window.clearInterval(again)
    }
  }, [])

  if (phase.kind === 'idle') return null
  const busy = phase.kind === 'downloading' || phase.kind === 'installing'
  // Offer (not force) outside the exam screen; once started, stay up until it finishes or fails.
  if (!busy && (onExamScreen || dismissed === phase.update.version)) return null

  const { update } = phase

  const install = async () => {
    let total = 0
    let received = 0
    setPhase({ kind: 'downloading', update, percent: null })
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0
        else if (event.event === 'Progress') {
          received += event.data.chunkLength
          setPhase({ kind: 'downloading', update, percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null })
        } else if (event.event === 'Finished') setPhase({ kind: 'installing', update })
      })
      await relaunch() // Windows usually restarts the app from the installer before reaching here
    } catch (caught) {
      setPhase({
        kind: 'error',
        update,
        message: caught instanceof Error ? caught.message : 'The update could not be installed.',
      })
    }
  }

  return (
    <div className="bg-ink/50 fixed inset-0 z-[100] flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="Update available">
      <div className="bg-card w-full max-w-md rounded-lg p-6 shadow-xl">
        <h2 className="text-ink text-[16px] font-semibold">AssessX {update.version} is available</h2>
        <p className="text-ink-subtle mt-1 text-[13px]">You have version {APP_VERSION}.</p>
        {update.body && <p className="text-ink mt-3 max-h-40 overflow-y-auto text-[13px] whitespace-pre-line">{update.body}</p>}

        {phase.kind === 'downloading' && (
          <div className="mt-4" aria-live="polite">
            <div className="bg-line h-2 overflow-hidden rounded-full">
              <div className="bg-accent h-full transition-all" style={{ width: `${phase.percent ?? 5}%` }} />
            </div>
            <p className="text-ink-subtle mt-1 text-[12px]">
              Downloading{phase.percent !== null ? ` — ${phase.percent}%` : '…'} Please keep the app open.
            </p>
          </div>
        )}
        {phase.kind === 'installing' && (
          <p className="text-ink-subtle mt-4 text-[13px]" aria-live="polite">
            Installing… AssessX will restart by itself.
          </p>
        )}
        {phase.kind === 'error' && (
          <p className="text-danger mt-4 text-[13px]" role="alert">
            Update failed: {phase.message}
          </p>
        )}

        {!busy && (
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDismissed(update.version)}>
              Later
            </Button>
            <Button onClick={() => void install()}>{phase.kind === 'error' ? 'Try again' : 'Update now'}</Button>
          </div>
        )}
      </div>
    </div>
  )
}
