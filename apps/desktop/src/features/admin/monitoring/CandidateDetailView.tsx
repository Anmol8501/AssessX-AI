import { useEffect, useRef, useState } from 'react'
import { CameraIcon, ClockIcon, MicIcon } from '@/components/icons'
import { Button, StatusBadge } from '@/components/ui'
import { useApi } from '@/features/session'
import { cn } from '@/lib/cn'
import { eventLabel } from './events'
import { deviceLabel, fullscreenLabel, tileStatus, type ConnectionState } from './status'
import { toEvent, type MonitoringEvent, type MonitoringSession } from './types'
import { useMediaViewer } from './useMediaViewer'
import type { MonitoringSignaling, Signal } from './useMonitoring'
import type { MediaState } from './webrtc'

interface DetailProps {
  session: MonitoringSession
  connection: ConnectionState
  signaling: MonitoringSignaling
  onClose(): void
}

const VIDEO_STATE_LABEL: Record<MediaState, string> = {
  idle: 'Live video unavailable',
  connecting: 'Connecting to candidate…',
  connected: '',
  unavailable: 'Candidate is not sharing video',
  failed: 'Live video unavailable — connection failed',
}

/**
 * The candidate detail view (Phase 4C): the large live video, current factual status, and recent
 * proctoring events, updating live. Opening it establishes the WebRTC stream for this one
 * candidate; closing it tears everything down. Audio is muted by default and only plays when the
 * admin turns it on. Nothing here interprets, scores or judges — it is technical state only.
 */
export function CandidateDetailView({ session, connection, signaling, onClose }: DetailProps) {
  const api = useApi()
  const viewer = useMediaViewer(session.attemptId, true, signaling)
  const [events, setEvents] = useState<MonitoringEvent[]>([])
  const [audioOn, setAudioOn] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  // Initial recent events over REST, then live PROCTORING_EVENT deltas prepended.
  useEffect(() => {
    let active = true
    void api<{ recent_events: Record<string, unknown>[] }>(`/api/v1/admin/monitoring/sessions/${session.attemptId}`)
      .then((detail) => {
        if (active) setEvents(detail.recent_events.map(toEvent))
      })
      .catch(() => undefined)
    const unsubscribe = signaling.subscribe(session.attemptId, (message: Signal) => {
      if (message.type === 'PROCTORING_EVENT' && message.event) {
        setEvents((prev) => [toEvent(message.event as Record<string, unknown>), ...prev].slice(0, 50))
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [api, session.attemptId, signaling])

  useEffect(() => {
    const element = video.current
    if (!element) return
    element.srcObject = viewer.stream
    element.muted = !audioOn
    if (viewer.stream) void element.play().catch(() => undefined)
  }, [viewer.stream, audioOn])

  // Escape closes, matching the app's dialog conventions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const status = tileStatus(session, connection)
  const camera = deviceLabel(session.cameraState)
  const microphone = deviceLabel(session.microphoneState)
  const fullscreen = fullscreenLabel(session.fullscreen)
  const showVideo = viewer.state === 'connected' && viewer.stream

  return (
    <div
      className="bg-ink/60 fixed inset-0 z-50 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Monitoring ${session.candidateName}`}
      onClick={onClose}
    >
      <div
        className="bg-card flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-line flex items-center justify-between border-b px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-ink truncate text-[15px] font-semibold">{session.candidateName}</h2>
            <p className="text-ink-subtle truncate text-[12.5px]">
              {session.assessmentTitle}
              {session.candidateRollNumber ? ` · ${session.candidateRollNumber}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge tone={status.tone} dot>
              {status.label}
            </StatusBadge>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid gap-4 p-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div>
              <div className="bg-ink/90 relative flex aspect-video items-center justify-center overflow-hidden rounded-md">
                <video
                  ref={video}
                  playsInline
                  autoPlay
                  aria-label={`${session.candidateName} live video`}
                  className={cn('h-full w-full object-contain', !showVideo && 'invisible')}
                />
                {!showVideo && (
                  <span className="absolute text-[13px] text-white/70">{VIDEO_STATE_LABEL[viewer.state]}</span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-ink-subtle text-[12px]">
                  Live view — not recorded. Audio is off until you enable it.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAudioOn((on) => !on)}
                  disabled={!showVideo}
                  leadingIcon={<MicIcon />}
                >
                  {audioOn ? 'Mute audio' : 'Enable audio'}
                </Button>
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
                <Detail icon={<CameraIcon />} label="Camera" value={camera.label} ok={camera.ok} />
                <Detail icon={<MicIcon />} label="Microphone" value={microphone.label} ok={microphone.ok} />
                <Detail label="Fullscreen" value={fullscreen.label} ok={fullscreen.ok} />
                <Detail label="Connection" value={connection === 'connected' ? 'Connected' : connection} ok={connection === 'connected'} />
              </dl>
            </div>

            <div>
              <h3 className="text-ink text-[13px] font-semibold">Recent events</h3>
              <ul className="mt-2 space-y-1.5" aria-label="Recent proctoring events">
                {events.length === 0 ? (
                  <li className="text-ink-subtle text-[12.5px]">No events recorded yet.</li>
                ) : (
                  events.map((event) => (
                    <li key={event.id} className="flex items-start gap-2 text-[12.5px]">
                      <ClockIcon className="text-ink-subtle mt-0.5 shrink-0 text-[13px]" />
                      <span className="text-ink-subtle tabular-nums">{formatTime(event.recordedAt)}</span>
                      <span className="text-ink">{eventLabel(event)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Detail({ icon, label, value, ok }: { icon?: React.ReactNode; label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {icon && <span className={cn('text-[14px]', ok ? 'text-ok' : 'text-warn')}>{icon}</span>}
      <span className="text-ink-subtle">{label}:</span>
      <span className={cn('font-medium', ok ? 'text-ink' : 'text-warn')}>{value}</span>
    </div>
  )
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString()
}
