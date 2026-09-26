import type { ReactNode } from 'react'
import { AlertIcon, ArrowLeftIcon, CheckIcon, InfoIcon, RefreshIcon, ShieldIcon, SpinnerIcon } from '@/components/icons'
import { Logo } from '@/components/Logo'
import { Button, Card } from '@/components/ui'
import type { DeviceReadiness as Readiness } from './useDeviceReadiness'

interface DeviceReadinessProps {
  examTitle: string
  readiness: Readiness
  onContinue(): void
  onBack(): void
}

/**
 * "Prepare your device" — the pre-exam device-readiness screen (Phase 4B.5, Standard mode).
 *
 * It lists prohibited applications that are open, offers to close them all gracefully, and rechecks.
 * The candidate cannot continue to the camera/microphone check until nothing prohibited is open.
 * It is honest about scope: this closes applications the candidate is running, it does not lock down
 * Windows.
 */
export function DeviceReadiness({ examTitle, readiness, onContinue, onBack }: DeviceReadinessProps) {
  const { status, detected, stubborn, busy } = readiness
  const clean = status === 'ready'

  return (
    <div className="bg-surface flex h-full w-full flex-col">
      <header className="border-line bg-card flex h-14 shrink-0 items-center gap-3 border-b px-6">
        <Logo size="sm" />
        <span className="bg-line h-5 w-px shrink-0" aria-hidden />
        <h1 className="text-ink truncate text-[14px] font-semibold">{examTitle}</h1>
      </header>

      <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-8 py-8">
        <Card className="w-full max-w-xl px-8 py-7">
          <div className="flex items-center gap-2">
            <ShieldIcon className="text-accent text-[20px]" />
            <h2 className="text-ink text-[20px] font-semibold tracking-tight">
              {clean ? 'Your device is ready' : 'Prepare your device'}
            </h2>
            {clean && <CheckIcon className="text-ok text-[18px]" />}
          </div>
          <p className="text-ink-muted mt-1 text-[13.5px]">
            {clean
              ? 'No prohibited applications are open. Continue to the camera and microphone check.'
              : 'AssessX needs a clean exam environment before you can continue. Please close these applications.'}
          </p>

          <div className="mt-6" aria-live="polite">
            {status === 'scanning' && detected.length === 0 ? (
              <Row icon={<SpinnerIcon className="text-[16px]" />} tone="muted" text="Checking for open applications…" />
            ) : clean ? (
              <Row icon={<CheckIcon className="text-[16px]" />} tone="ok" text="No prohibited applications detected." />
            ) : (
              <ul className="divide-line flex flex-col divide-y" aria-label="Prohibited applications">
                {detected.map((app) => (
                  <li key={app.id} className="flex items-center gap-3 py-2.5">
                    <span className="bg-danger h-2 w-2 shrink-0 rounded-full" aria-hidden />
                    <span className="text-ink flex-1 text-[14px] font-medium">{app.displayName}</span>
                    <span className="text-ink-subtle text-[12px] capitalize">{app.category.replace('-', ' ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {stubborn.length > 0 && status === 'blocked' && (
            <p className="text-danger mt-3 flex items-start gap-2 text-[12.5px]" role="alert">
              <AlertIcon className="mt-0.5 shrink-0 text-[14px]" />
              Some applications could not be closed automatically. Please close them yourself, then select Recheck.
            </p>
          )}

          <p className="text-ink-subtle mt-6 flex items-start gap-2 text-[12.5px]">
            <InfoIcon className="mt-0.5 shrink-0 text-[14px]" />
            Closing asks each application to close normally, so you can save your work first. AssessX never forces an
            application to close, and this check does not restrict Windows itself.
          </p>

          <div className="mt-6 flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={onBack} leadingIcon={<ArrowLeftIcon />} disabled={busy}>
              Exam details
            </Button>
            <div className="flex items-center gap-3">
              <Button variant="secondary" leadingIcon={<RefreshIcon />} onClick={readiness.rescan} disabled={busy}>
                Recheck
              </Button>
              {clean ? (
                <Button onClick={onContinue} disabled={busy}>
                  Continue
                </Button>
              ) : (
                <Button onClick={readiness.closeAll} loading={busy} disabled={detected.length === 0}>
                  Close All Detected Apps
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function Row({ icon, tone, text }: { icon: ReactNode; tone: 'ok' | 'muted'; text: string }) {
  return (
    <div className={`flex items-center gap-2 text-[14px] ${tone === 'ok' ? 'text-ok' : 'text-ink-subtle'}`} role="status">
      {icon}
      {text}
    </div>
  )
}
