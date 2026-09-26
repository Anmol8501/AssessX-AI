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
export function ProctoringStatus({ camera, microphone }: { camera: MediaDevice; microphone: MediaDevice }) {
  return (
    <div className="flex items-center gap-3" aria-label="Proctoring status">
      <CameraPreview stream={camera.stream} className="h-9 w-16" placeholder="" />
      <DeviceChip device={camera} icon={<CameraIcon />} />
      <DeviceChip device={microphone} icon={<MicIcon />} />
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
