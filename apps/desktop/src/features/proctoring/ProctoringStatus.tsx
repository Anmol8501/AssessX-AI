import type { ReactNode } from 'react'
import { CameraIcon, MicIcon } from '@/components/icons'
import { cn } from '@/lib/cn'
import { CameraPreview } from './CameraPreview'
import { DEVICE_LABEL } from './devices'
import type { MediaDevice } from './useMediaDevice'

/**
 * The exam header's proctoring indicator: a small self-view and one status per device.
 *
 * Informational, not a warning system — a device that drops shows as not connected with a way to
 * reconnect, and the exam carries on. How the platform should react to a lost device is an open
 * decision (`docs/PHASE-4-PLAN.md`), and candidate warnings belong to Phase 4B.
 */
export function ProctoringStatus({
  camera,
  microphone,
  secondaryCameraStream,
}: {
  camera: MediaDevice
  microphone: MediaDevice
  secondaryCameraStream?: MediaStream | null
}) {
  return (
    <div className="flex items-center gap-3" aria-label="Proctoring status">
      <CameraPreview stream={camera.stream} className="h-9 w-16" placeholder="" />
      {secondaryCameraStream && (
        <div className="relative h-9 w-16 overflow-hidden rounded border border-line bg-black">
          <CameraPreview stream={secondaryCameraStream} className="h-9 w-16" placeholder="" />
          <span className="absolute bottom-0 right-0 rounded bg-black/70 px-1 text-[9px] font-mono text-emerald-400">2nd</span>
        </div>
      )}
      <DeviceChip device={camera} icon={<CameraIcon />} />
      <DeviceChip device={microphone} icon={<MicIcon />} />
      {secondaryCameraStream !== undefined && (
        <span
          className="flex items-center gap-1.5 text-[12px] font-medium text-ink-subtle"
          title="Secondary mobile phone camera status"
        >
          <span className={secondaryCameraStream ? 'text-ok' : 'text-danger'}>📱</span>
          <span className={secondaryCameraStream ? 'text-ok' : 'text-danger'}>
            {secondaryCameraStream ? '2nd Cam Live' : '2nd Cam Offline'}
          </span>
        </span>
      )}
    </div>
  )
}

function DeviceChip({ device, icon }: { device: MediaDevice; icon: ReactNode }) {
  const ready = device.status === 'READY'
  const checking = device.status === 'CHECKING'
  const label = DEVICE_LABEL[device.kind]
  return (
    <span className="flex items-center gap-1.5" role="status" aria-label={`${label}: ${ready ? 'connected' : 'not connected'}`}>
      <span className={cn('text-[15px]', ready ? 'text-ok' : 'text-danger')}>{icon}</span>
      {!ready && (
        <button
          type="button"
          onClick={device.check}
          disabled={checking}
          title={device.message ?? undefined}
          className="text-danger text-[12px] font-medium hover:underline disabled:opacity-60"
        >
          {checking ? 'Reconnecting…' : `Reconnect ${label.toLowerCase()}`}
        </button>
      )}
    </span>
  )
}
