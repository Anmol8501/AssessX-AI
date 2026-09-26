import { useEffect, useState, type ReactNode } from 'react'
import { AlertIcon, CheckIcon, InfoIcon, ShieldIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, Input, StatusBadge } from '@/components/ui'
import { generateKioskConfig, kioskAvailable, kioskStatus, type KioskConfig, type KioskStatus } from './kiosk'

/**
 * Secure Kiosk status and provisioning for administrators (Phase 4B.5, Mode B).
 *
 * It shows whether this machine is running under a Windows-managed kiosk or only AssessX's own
 * application-level controls, and — on a supported edition — generates an administrator provisioning
 * package. It never applies anything: an administrator reviews the scripts and runs them on a
 * dedicated exam machine. This is deliberately honest about the difference between the two.
 */
export function SecureKioskCard() {
  const [status, setStatus] = useState<KioskStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<KioskConfig | null>(null)
  const [account, setAccount] = useState('assessx-exam')
  const [busy, setBusy] = useState(false)

  const available = kioskAvailable()

  useEffect(() => {
    if (!available) return
    kioskStatus()
      .then(setStatus)
      .catch(() => setError('Could not read the Windows security configuration.'))
  }, [available])

  async function generate() {
    setBusy(true)
    setError(null)
    try {
      setConfig(await generateKioskConfig(account, ''))
    } catch {
      setError('Could not generate the provisioning package.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Secure Kiosk Mode"
        description="Windows-managed exam lockdown for institution machines."
        actions={
          status ? (
            <StatusBadge tone={status.kioskActive ? 'ok' : 'neutral'} dot>
              {status.kioskActive ? 'Secure Kiosk' : 'Standard'}
            </StatusBadge>
          ) : undefined
        }
      />
      <CardBody className="space-y-4">
        {!available ? (
          <Note>Secure Kiosk status is only available in the installed Windows application.</Note>
        ) : !status ? (
          <Note>{error ?? 'Reading the Windows security configuration…'}</Note>
        ) : (
          <>
            <p className="text-ink flex items-start gap-2 text-[13.5px]">
              <ShieldIcon className="text-accent mt-0.5 shrink-0 text-[16px]" />
              {status.summary}
            </p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px]">
              <Detail label="Windows edition" value={status.windowsEdition} />
              <Detail
                label="Assigned Access"
                value={status.assignedAccessSupported ? 'Supported' : 'Not supported'}
                ok={status.assignedAccessSupported}
              />
            </dl>

            {/* The distinction the whole feature turns on. */}
            <div className="border-line bg-surface rounded-md border px-3 py-2.5 text-[12.5px]">
              <p className="text-ink font-medium">Standard mode is application-level security.</p>
              <p className="text-ink-muted mt-0.5">
                AssessX controls its own window: fullscreen, clipboard, focus tracking and the device check. It cannot
                stop Windows shortcuts such as Alt+Tab or the Windows key. Secure Kiosk Mode adds Windows-managed
                restriction of the whole account and must be provisioned by an administrator on a dedicated machine.
              </p>
            </div>

            {status.assignedAccessSupported && (
              <div className="space-y-3">
                <div className="flex items-end gap-3">
                  <label className="flex-1">
                    <span className="text-ink-subtle text-[12px]">Kiosk account name</span>
                    <Input value={account} onChange={(e) => setAccount(e.target.value)} className="mt-1" />
                  </label>
                  <Button onClick={() => void generate()} loading={busy}>
                    Prepare kiosk configuration
                  </Button>
                </div>
                <Note>
                  This generates a configuration and apply/remove scripts for an administrator to review and run. It
                  does not change this machine.
                </Note>
              </div>
            )}

            {config?.available && (
              <div className="space-y-3">
                <p className="text-ok flex items-center gap-1.5 text-[13px] font-medium">
                  <CheckIcon className="text-[15px]" /> Provisioning package generated
                </p>
                <Artifact label="Assigned Access configuration (XML)" text={config.assignedAccessXml} />
                <Artifact label="Apply script (run as administrator)" text={config.applyScript} />
                <Artifact label="Remove / recovery script" text={config.removeScript} />
                <p className="text-ink-muted flex items-start gap-2 text-[12px]">
                  <AlertIcon className="text-warn mt-0.5 shrink-0 text-[14px]" />
                  {config.notes}
                </p>
              </div>
            )}
            {config && !config.available && <Note>{config.notes}</Note>}
            {error && (
              <p className="text-danger text-[13px]" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}

function Detail({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div>
      <dt className="text-ink-subtle text-[12px]">{label}</dt>
      <dd className={`mt-0.5 font-medium ${ok === false ? 'text-ink-muted' : 'text-ink'}`}>{value}</dd>
    </div>
  )
}

function Artifact({ label, text }: { label: string; text: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Clipboard blocked; the admin can still select the text.
    }
  }
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-ink-subtle text-[12px] font-medium">{label}</span>
        <button type="button" onClick={() => void copy()} className="text-accent text-[12px] font-medium hover:underline">
          Copy
        </button>
      </div>
      <pre className="border-line bg-ink/90 max-h-48 overflow-auto rounded-md border p-3 text-[11.5px] leading-relaxed text-white/90">
        {text}
      </pre>
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="text-ink-subtle flex items-start gap-2 text-[12.5px]">
      <InfoIcon className="mt-0.5 shrink-0 text-[14px]" />
      {children}
    </p>
  )
}
