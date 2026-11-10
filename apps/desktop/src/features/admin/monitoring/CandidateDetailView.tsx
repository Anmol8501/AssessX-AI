import { useEffect, useMemo, useRef, useState } from 'react'
import { CameraIcon, ClockIcon, MicIcon } from '@/components/icons'
import { routes } from '@/app/routes'
import { Button, ButtonLink, StatusBadge } from '@/components/ui'
import { useApi } from '@/features/session'
import { cn } from '@/lib/cn'
import { EvidenceTimeline } from '../evidence/EvidenceTimeline'
import { AttemptRiskPanel } from '../risk/AttemptRiskPanel'
import { AIMonitoringSection } from './AIMonitoringSection'
import { ExamControlPanel } from './ExamControlPanel'
import { eventLabel } from './events'
import { filterMonitoringEvents } from './filters'
import { candidatePresenceLabel, deviceLabel, fullscreenLabel, tileStatus, type ConnectionState } from './status'
import { toEvent, type MonitoringEvent, type MonitoringSession } from './types'
import { useMediaViewer } from './useMediaViewer'
import { FALLBACK_POLL_MS, type MonitoringSignaling, type Signal } from './useMonitoring'
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
 * The candidate detail view (Phase 4C): the large live video, current factual status, the on-device
 * AI's factual state (Phase 5C), and recent proctoring events, updating live. Opening it establishes the WebRTC stream for this one
 * candidate; closing it tears everything down. Audio is muted by default and only plays when the
 * admin turns it on. Nothing here interprets, scores or judges — it is technical state only.
 */
export function CandidateDetailView({ session, connection, signaling, onClose }: DetailProps) {
  const api = useApi()
  const live = connection === 'connected'
  const [streamEnabled, setStreamEnabled] = useState(true)
  // Video is requested only when live connection is up and administrator stream viewing is active.
  const viewer = useMediaViewer(session.attemptId, live && streamEnabled, signaling)
  const [events, setEvents] = useState<MonitoringEvent[]>([])
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [severityFilter, setSeverityFilter] = useState('ALL')
  const [audioOn, setAudioOn] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  const filteredEvents = useMemo(
    () => filterMonitoringEvents(events, categoryFilter, severityFilter),
    [events, categoryFilter, severityFilter],
  )

  // Audit stream grant/termination cleanly on open/toggle/close
  useEffect(() => {
    if (!live || !streamEnabled) return
    void api(`/api/v1/admin/monitoring/sessions/${session.attemptId}/stream/request`, { method: 'POST' }).catch(
      () => undefined,
    )
    return () => {
      void api(`/api/v1/admin/monitoring/sessions/${session.attemptId}/stream/terminate`, { method: 'POST' }).catch(
        () => undefined,
      )
    }
  }, [api, session.attemptId, live, streamEnabled])

  // Recent events over REST — on open, again whenever the live connection returns (to catch what was
  // missed), and every few seconds while it is down — plus live PROCTORING_EVENT deltas prepended.
  useEffect(() => {
    let active = true
    const load = () =>
      void api<{ items: Record<string, unknown>[] }>(
        `/api/v1/admin/attempts/${session.attemptId}/proctoring/events?limit=100`,
      )
        .then((res) => {
          if (active && Array.isArray(res.items)) {
            setEvents(res.items.map(toEvent))
          }
        })
        .catch(() => {
          // Fallback to legacy monitoring detail endpoint if events endpoint unavailable
          void api<{ recent_events: Record<string, unknown>[] }>(
            `/api/v1/admin/monitoring/sessions/${session.attemptId}`,
          )
            .then((detail) => {
              if (active) setEvents(detail.recent_events.map(toEvent))
            })
            .catch(() => undefined)
        })
    load()
    const timer = live ? null : window.setInterval(load, FALLBACK_POLL_MS)
    return () => {
      active = false
      if (timer !== null) window.clearInterval(timer)
    }
  }, [api, session.attemptId, live])

  useEffect(() => {
    const unsubscribe = signaling.subscribe(session.attemptId, (message: Signal) => {
      if (message.type === 'PROCTORING_EVENT' && message.event) {
        const event = toEvent(message.event as Record<string, unknown>)
        // A delta can arrive after the REST snapshot that already contains the same row.
        setEvents((prev) => (prev.some((e) => e.id === event.id) ? prev : [event, ...prev].slice(0, 50)))
      }
    })
    return unsubscribe
  }, [session.attemptId, signaling])

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
  // Once the candidate's app is offline, a still-open video connection shows only a frozen last
  // frame until it times out; hide it rather than present stale video as live.
  const showVideo = viewer.state === 'connected' && viewer.stream && session.candidateConnected
  const presence = candidatePresenceLabel(session)
  // Say *why* there is no video: the admin's own connection, the candidate's app, or the media path.
  const videoMessage = !live
    ? 'Reconnecting to the server…'
    : !session.candidateConnected
      ? 'Candidate app is offline'
      : VIDEO_STATE_LABEL[viewer.state]

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
                  <span className="absolute text-[13px] text-white/70">{videoMessage}</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-ink-subtle text-[12px]">
                  Live view — not recorded. Stream state: <strong className="text-ink">{streamEnabled ? viewer.state : 'stopped'}</strong>
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setStreamEnabled((en) => !en)}
                  >
                    {streamEnabled ? 'Stop stream' : 'Request stream'}
                  </Button>
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
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
                <Detail icon={<CameraIcon />} label="Camera" value={session.selectedCameraLabel ? `${camera.label} (${session.selectedCameraLabel})` : camera.label} ok={camera.ok} />
                <Detail icon={<MicIcon />} label="Microphone" value={session.selectedMicrophoneLabel ? `${microphone.label} (${session.selectedMicrophoneLabel})` : microphone.label} ok={microphone.ok} />
                <Detail label="Fullscreen" value={fullscreen.label} ok={fullscreen.ok} />
                <Detail label="Connection" value={connection === 'connected' ? 'Connected' : connection} ok={connection === 'connected'} />
                <Detail label="Candidate app" value={presence.label} ok={presence.ok} />
                <Detail label="Interruptions" value={String(session.interruptionCount ?? 0)} ok={(session.interruptionCount ?? 0) === 0} />
              </dl>

              <ExamControlPanel session={session} />
              <AIMonitoringSection ai={session.ai} />
              {/* Phase 6A: the server's risk state, refreshed as this candidate's events arrive. */}
              <AttemptRiskPanel attemptId={session.attemptId} live refreshKey={events[0]?.id} />
              {/* Phase 6B: the evidence behind that risk, refreshed the same way. */}
              <EvidenceTimeline attemptId={session.attemptId} refreshKey={events[0]?.id} />
              {/* Phase 6C: notes can be started live; an outcome is recorded after the attempt ends. */}
              <div className="mt-3">
                <ButtonLink to={routes.admin.review(session.attemptId)} variant="secondary" size="sm">
                  Open review
                </ButtonLink>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-ink text-[13px] font-semibold">Event timeline ({filteredEvents.length})</h3>
              </div>
              <div className="mt-2 flex gap-2">
                <select
                  aria-label="Filter timeline category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="border-line bg-surface text-ink rounded border px-2 py-1 text-[11.5px] outline-none"
                >
                  <option value="ALL">All categories</option>
                  <option value="WINDOW">Window</option>
                  <option value="INPUT">Input</option>
                  <option value="DEVICE">Device</option>
                  <option value="DISPLAY">Display</option>
                  <option value="SYSTEM">System</option>
                  <option value="RECOVERY">Recovery</option>
                </select>
                <select
                  aria-label="Filter timeline severity"
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="border-line bg-surface text-ink rounded border px-2 py-1 text-[11.5px] outline-none"
                >
                  <option value="ALL">All severities</option>
                  <option value="CRITICAL">Critical</option>
                  <option value="HIGH">High</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LOW">Low</option>
                  <option value="INFO">Info</option>
                </select>
              </div>
              <ul className="mt-3 max-h-[420px] space-y-1.5 overflow-y-auto pr-1" aria-label="Recent proctoring events">
                {filteredEvents.length === 0 ? (
                  <li className="text-ink-subtle text-[12.5px]">No matching events recorded yet.</li>
                ) : (
                  filteredEvents.map((event) => (
                    <li key={event.id} className="flex items-start gap-2 text-[12.5px]">
                      <ClockIcon className="text-ink-subtle mt-0.5 shrink-0 text-[13px]" />
                      <span className="text-ink-subtle shrink-0 tabular-nums">{formatTime(event.recordedAt)}</span>
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
