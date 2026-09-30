import type { ReactNode } from 'react'
import { AlertIcon, ArrowLeftIcon, CameraIcon, CheckIcon, ClockIcon, InfoIcon, MicIcon, RefreshIcon, SpinnerIcon } from '@/components/icons'
import { Logo } from '@/components/Logo'
import { Button, Card } from '@/components/ui'
import { cn } from '@/lib/cn'
import { CameraPreview } from './CameraPreview'
import { DEVICE_LABEL, type LocalDeviceStatus } from './devices'
import { useAudioLevel } from './useAudioLevel'
import type { MediaDevice } from './useMediaDevice'

export type SessionCheck =
  | { status: 'ready'; detail: string }
  | { status: 'working'; detail: string }
  | { status: 'error'; detail: string }

interface ProctoringCheckProps {
  examTitle: string
  camera: MediaDevice
  microphone: MediaDevice
  session: SessionCheck
  /** True when an attempt is already running — its clock does not wait for this screen. */
  resuming: boolean
  busy: boolean
  onContinue(): void
  onBack(): void
}

/**
 * The proctoring readiness check (Phase 4A), shown before a proctored exam is entered.
 *
 * It checks exactly two things on this device — that the camera and the microphone can be opened
 * — and says so. It does not look for a face, listen for voices or judge the room; nothing here
 * is analysed, recorded or uploaded. The exam cannot be entered until both devices are ready,
 * and the server refuses to activate the session otherwise.
 */
export function ProctoringCheck({ examTitle, camera, microphone, session, resuming, busy, onContinue, onBack }: ProctoringCheckProps) {
  const level = useAudioLevel(microphone.stream)
  const devicesReady = camera.status === 'READY' && microphone.status === 'READY'
  const canContinue = devicesReady && session.status !== 'working' && !busy

  return (
    <div className="bg-surface flex h-full w-full flex-col">
      <header className="border-line bg-card flex h-14 shrink-0 items-center gap-3 border-b px-6">
        <Logo size="sm" />
        <span className="bg-line h-5 w-px shrink-0" aria-hidden />
        <h1 className="text-ink truncate text-[14px] font-semibold">{examTitle}</h1>
      </header>

      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-8 py-8">
        <Card className="w-full max-w-3xl px-8 py-7">
          <h2 className="text-ink text-[20px] font-semibold tracking-tight">Proctoring check</h2>
          <p className="text-ink-muted mt-1 text-[13.5px]">
            This exam is proctored. Before you begin, AssessX checks that your camera and microphone can be used on
            this device.
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <CameraPreview
              stream={camera.stream}
              className="aspect-video w-full"
              placeholder={camera.status === 'CHECKING' ? 'Starting camera…' : 'No camera picture'}
            />

            <ul className="divide-line flex flex-col divide-y" aria-label="Proctoring checks">
              <DeviceRow icon={<CameraIcon />} device={camera} />
              <DeviceRow icon={<MicIcon />} device={microphone} extra={<LevelMeter level={level} active={microphone.status === 'READY'} />} />
              <CheckRow
                icon={<ClockIcon />}
                label="Exam session"
                state={session.status === 'ready' ? 'ok' : session.status === 'working' ? 'busy' : 'bad'}
                stateLabel={session.status === 'ready' ? 'Ready' : session.status === 'working' ? 'Starting…' : 'Not ready'}
                detail={session.detail}
              />
            </ul>
          </div>

          <p className="text-ink-subtle mt-6 flex items-start gap-2 text-[12.5px]">
            <InfoIcon className="mt-0.5 shrink-0 text-[14px]" />
            The picture is shown only to you, on this device. Nothing from your camera or microphone is recorded or
            uploaded — AssessX only records whether each device is available. Both stay on while you take the exam and
            are switched off when it ends.
          </p>

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={onBack} leadingIcon={<ArrowLeftIcon />} disabled={busy}>
              Exam details
            </Button>
            <div className="flex items-center gap-3">
              {!devicesReady && camera.status !== 'CHECKING' && microphone.status !== 'CHECKING' && (
                <Button
                  variant="secondary"
                  leadingIcon={<RefreshIcon />}
                  onClick={() => {
                    if (camera.status !== 'READY') camera.check()
                    if (microphone.status !== 'READY') microphone.check()
                  }}
                >
                  Retry
                </Button>
              )}
              <Button onClick={onContinue} loading={busy} disabled={!canContinue}>
                {resuming ? 'Continue Exam' : 'Start Exam'}
              </Button>
            </div>
          </div>
          {!resuming && (
            <p className="text-ink-subtle mt-3 text-right text-[12px]">The exam clock starts when you start the exam.</p>
          )}
        </Card>
      </div>
    </div>
  )
}

type RowState = 'ok' | 'busy' | 'bad' | 'idle'

function rowStateOf(status: LocalDeviceStatus): RowState {
  if (status === 'READY') return 'ok'
  if (status === 'CHECKING') return 'busy'
  if (status === 'NOT_CHECKED') return 'idle'
  return 'bad'
}

const STATUS_LABEL: Record<LocalDeviceStatus, string> = {
  NOT_CHECKED: 'Not checked',
  CHECKING: 'Checking…',
  READY: 'Ready',
  DENIED: 'Access blocked',
  UNAVAILABLE: 'Not available',
  ERROR: 'Could not start',
}

function DeviceRow({ icon, device, extra }: { icon: ReactNode; device: MediaDevice; extra?: ReactNode }) {
  return (
    <CheckRow
      icon={icon}
      label={DEVICE_LABEL[device.kind]}
      state={rowStateOf(device.status)}
      stateLabel={STATUS_LABEL[device.status]}
      detail={device.message}
      extra={extra}
    />
  )
}

function CheckRow({
  icon,
  label,
  state,
  stateLabel,
  detail,
  extra,
}: {
  icon: ReactNode
  label: string
  state: RowState
  stateLabel: string
  detail?: string | null
  extra?: ReactNode
}) {
  return (
    <li className="py-3 first:pt-0" data-check={label}>
      <div className="flex items-center gap-3">
        <span className="text-ink-subtle text-[17px]">{icon}</span>
        <span className="text-ink flex-1 text-[14px] font-medium">{label}</span>
        <span
          className={cn(
            'flex items-center gap-1.5 text-[13px] font-medium',
            state === 'ok' && 'text-ok',
            state === 'bad' && 'text-danger',
            (state === 'busy' || state === 'idle') && 'text-ink-subtle',
          )}
          role="status"
          aria-label={`${label}: ${stateLabel}`}
        >
          {state === 'ok' && <CheckIcon className="text-[15px]" />}
          {state === 'bad' && <AlertIcon className="text-[15px]" />}
          {state === 'busy' && <SpinnerIcon className="text-[15px]" />}
          {stateLabel}
        </span>
      </div>
      {extra && <div className="mt-2 pl-8">{extra}</div>}
      {detail && (
        <p className={cn('mt-1.5 pl-8 text-[12.5px]', state === 'bad' ? 'text-danger' : 'text-ink-subtle')}>
          {detail}
        </p>
      )}
    </li>
  )
}

/** A small input-level bar. The level is computed on this device and never leaves it. */
function LevelMeter({ level, active }: { level: number; active: boolean }) {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      <div className="bg-line h-1.5 w-full max-w-[180px] overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full transition-[width] duration-100', active ? 'bg-ok' : 'bg-ink-subtle')}
          style={{ width: `${Math.round((active ? level : 0) * 100)}%` }}
        />
      </div>
      <span className="text-ink-subtle text-[11.5px]">{active ? 'Speak to test' : ''}</span>
    </div>
  )
}
