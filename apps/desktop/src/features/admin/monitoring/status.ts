/**
 * Turns factual monitoring state into neutral, human labels for the admin wall (Phase 4C).
 *
 * These are technical states, never judgements. "Fullscreen exited" and "Camera issue" describe
 * what the software observed; none of them means "cheating", "suspicious" or "risk". Status is
 * conveyed with an icon and text (never colour alone) for accessibility.
 */

import type { StatusTone } from '@/components/ui'
import type { MonitoringSession } from './types'

/** Whether the admin's realtime link to a candidate is live. Separate from the exam session. */
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected'

export interface TileStatus {
  label: string
  tone: StatusTone
}

/**
 * The single headline status for a tile, chosen by a deterministic priority so the most important
 * factual signal wins: the admin's own connection first, then whether the candidate's app is
 * connected at all, then device issues, then a fullscreen exit, then active.
 * The tile also shows the individual device/session indicators, so nothing is hidden by this label.
 */
export function tileStatus(session: MonitoringSession, connection: ConnectionState): TileStatus {
  if (session.attemptStatus !== 'IN_PROGRESS' || session.proctoringStatus === 'ENDED') {
    return { label: 'Finished', tone: 'neutral' }
  }
  if (session.onHold) return { label: 'Exam locked', tone: 'danger' }
  if (connection === 'disconnected') return { label: 'Disconnected', tone: 'danger' }
  if (connection === 'reconnecting') return { label: 'Reconnecting', tone: 'warn' }
  if (!session.candidateConnected) return { label: 'Candidate offline', tone: 'danger' }
  if (session.cameraState !== 'READY') return { label: 'Camera issue', tone: 'warn' }
  if (session.microphoneState !== 'READY') return { label: 'Microphone issue', tone: 'warn' }
  if (session.fullscreen === false) return { label: 'Fullscreen exit', tone: 'warn' }
  return { label: 'Active', tone: 'ok' }
}

export function deviceLabel(state: MonitoringSession['cameraState']): { label: string; ok: boolean } {
  switch (state) {
    case 'READY':
      return { label: 'Connected', ok: true }
    case 'DENIED':
      return { label: 'Blocked', ok: false }
    case 'UNAVAILABLE':
      return { label: 'Not available', ok: false }
    default:
      return { label: 'Not ready', ok: false }
  }
}

export function fullscreenLabel(fullscreen: boolean | null): { label: string; ok: boolean } {
  if (fullscreen === null) return { label: 'Unknown', ok: false }
  return fullscreen ? { label: 'Active', ok: true } : { label: 'Exited', ok: false }
}

/** The candidate app's connection, as a label with how long it has been in that state when known. */
export function candidatePresenceLabel(session: MonitoringSession, now: number = Date.now()): { label: string; ok: boolean } {
  const since = session.candidatePresenceChangedAt ? Date.parse(session.candidatePresenceChangedAt) : Number.NaN
  const base = session.candidateConnected ? 'Online' : 'Offline'
  if (Number.isNaN(since)) return { label: base, ok: session.candidateConnected }
  const seconds = Math.max(0, Math.round((now - since) / 1000))
  const span = seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`
  return { label: session.candidateConnected ? base : `${base} for ${span}`, ok: session.candidateConnected }
}
