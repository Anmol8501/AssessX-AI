import { CameraIcon, MicIcon, MonitoringIcon } from '@/components/icons'
import { StatusBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { deviceLabel, fullscreenLabel, tileStatus, type ConnectionState } from './status'
import type { MonitoringSession } from './types'

interface TileProps {
  session: MonitoringSession
  connection: ConnectionState
  onOpen(): void
}

/**
 * One candidate on the monitoring wall (Phase 4C).
 *
 * Shows factual state only — who they are, their session/device status, and the individual
 * indicators. Live video is established from the detail view (opening the tile), so the wall does
 * not hold up to sixteen simultaneous media connections; the tile shows a compact placeholder and
 * invites the admin to open it. Keyboard accessible; status uses icon + text, never colour alone.
 */
export function CandidateMonitoringTile({ session, connection, onOpen }: TileProps) {
  const status = tileStatus(session, connection)
  const camera = deviceLabel(session.cameraState)
  const microphone = deviceLabel(session.microphoneState)
  const fullscreen = fullscreenLabel(session.fullscreen)

  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-line bg-card hover:border-accent focus:ring-accent-ring flex flex-col overflow-hidden rounded-lg border text-left transition-colors focus:ring-2 focus:outline-none"
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <span className="text-ink truncate text-[13px] font-semibold">{session.candidateName}</span>
        <StatusBadge tone={status.tone} dot>
          {status.label}
        </StatusBadge>
      </div>
      <p className="text-ink-subtle truncate px-3 text-[12px]">{session.assessmentTitle}</p>

      {/* Video placeholder — the real stream is in the detail view (see the component doc). */}
      <div className="bg-ink/90 mx-3 mt-2 flex aspect-video items-center justify-center rounded-md">
        <span className="flex flex-col items-center gap-1 text-[11px] text-white/60">
          <MonitoringIcon className="text-[18px]" />
          Open to view video
        </span>
      </div>

      <dl className="text-ink-muted grid grid-cols-2 gap-x-2 gap-y-1 px-3 py-3 text-[11.5px]">
        <Indicator icon={<CameraIcon />} label="Camera" value={camera.label} ok={camera.ok} />
        <Indicator icon={<MicIcon />} label="Mic" value={microphone.label} ok={microphone.ok} />
        <Indicator label="Fullscreen" value={fullscreen.label} ok={fullscreen.ok} />
        <Indicator label="Session" value={connection === 'connected' ? 'Live' : 'Offline'} ok={connection === 'connected'} />
      </dl>
    </button>
  )
}

function Indicator({ icon, label, value, ok }: { icon?: React.ReactNode; label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      {icon && <span className={cn('text-[13px]', ok ? 'text-ok' : 'text-warn')}>{icon}</span>}
      <span className="text-ink-subtle">{label}:</span>
      <span className={cn('font-medium', ok ? 'text-ink' : 'text-warn')}>{value}</span>
    </div>
  )
}
