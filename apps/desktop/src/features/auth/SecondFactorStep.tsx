import { useEffect, useState, type FormEvent } from 'react'
import { AlertIcon, LockIcon } from '@/components/icons'
import { Button, Checkbox, Field, Input } from '@/components/ui'
import { useApi } from '@/features/session'
import { ApiError } from '@/lib/api'

interface Enrolment {
  secret: string
  otpauth_uri: string
}

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return error.message
    if (error.code === 'mfa_invalid') return 'That code is not valid. Use the newest code from your authenticator app.'
    if (error.code === 'too_many_attempts') return error.message
    return error.message
  }
  return 'Something went wrong. Please try again.'
}

/** Groups of four, so the set-up key can be typed into an authenticator app without mistakes. */
function grouped(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

/**
 * The administrator second factor (Phase 8 final, CX-07) — part of signing in, before anything else:
 *
 * * `required`: a 6-digit code from the authenticator app, or a one-time recovery code.
 * * `enroll`: first time — the set-up key for the authenticator app, a first code to confirm it, then ten
 *   recovery codes shown once (each works one time; keep them somewhere safe and offline).
 *
 * Nothing secret is stored on this machine; the set-up key is shown only while this step is open.
 */
export function SecondFactorStep({ mode, onDone, onCancel }: { mode: 'required' | 'enroll'; onDone: () => void; onCancel: () => void }) {
  const api = useApi()
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (mode !== 'enroll') return
    let cancelled = false
    api<Enrolment>('/api/v1/auth/mfa/enroll', { method: 'POST' })
      .then((data) => !cancelled && setEnrolment(data))
      .catch((caught: unknown) => !cancelled && setError(describe(caught)))
    return () => {
      cancelled = true
    }
  }, [api, mode])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const value = code.trim()
    if (!value) return setError(useRecovery ? 'Enter a recovery code.' : 'Enter the 6-digit code.')
    setBusy(true)
    try {
      if (mode === 'enroll') {
        const result = await api<{ recovery_codes: string[] }>('/api/v1/auth/mfa/enable', { method: 'POST', body: { code: value } })
        setRecoveryCodes(result.recovery_codes)
      } else {
        await api<void>('/api/v1/auth/mfa/verify', { method: 'POST', body: useRecovery ? { recovery_code: value } : { code: value } })
        onDone()
      }
    } catch (caught) {
      setError(describe(caught))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  if (recoveryCodes) {
    return (
      <div className="space-y-4" aria-label="Recovery codes">
        <div>
          <h2 className="text-ink text-[15px] font-semibold">Save your recovery codes</h2>
          <p className="text-ink-muted mt-1 text-[13px]">
            Each code signs you in once if you lose your authenticator. They are shown only now — keep them offline (a password manager or a printed copy), never in email or chat.
          </p>
        </div>
        <ul className="border-line bg-surface grid grid-cols-2 gap-1.5 rounded-md border p-3 font-mono text-[13px] select-all">
          {recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Checkbox label="I have saved these codes somewhere safe" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <Button className="w-full" disabled={!saved} onClick={onDone}>
          Continue
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4" aria-label="Two-step sign-in">
      <div className="flex items-start gap-2">
        <LockIcon className="text-accent mt-0.5 text-[18px]" aria-hidden="true" />
        <div>
          <h2 className="text-ink text-[15px] font-semibold">{mode === 'enroll' ? 'Set up two-step sign-in' : 'Two-step sign-in'}</h2>
          <p className="text-ink-muted mt-1 text-[13px]">
            {mode === 'enroll'
              ? 'Administrator accounts need an authenticator app (for example Microsoft Authenticator or Google Authenticator). Add this key to it, then enter the 6-digit code it shows.'
              : useRecovery
                ? 'Enter one of your recovery codes. Each code works once.'
                : 'Enter the 6-digit code from your authenticator app.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
          <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
          {error}
        </div>
      )}

      {mode === 'enroll' && (
        <div className="border-line bg-surface rounded-md border p-3">
          <p className="text-ink-subtle text-[12px]">Set-up key (choose "enter a set-up key", time-based)</p>
          <p className="text-ink mt-1 font-mono text-[14px] tracking-wider select-all" data-mfa="secret">
            {enrolment ? grouped(enrolment.secret) : 'Preparing…'}
          </p>
        </div>
      )}

      <Field label={useRecovery ? 'Recovery code' : 'Code'}>
        {({ id }) => (
          <Input
            id={id}
            autoFocus
            autoComplete="one-time-code"
            inputMode={useRecovery ? 'text' : 'numeric'}
            maxLength={useRecovery ? 20 : 6}
            className="font-mono tracking-widest"
            value={code}
            onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))}
            disabled={busy || (mode === 'enroll' && !enrolment)}
          />
        )}
      </Field>

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" loading={busy}>
          {mode === 'enroll' ? 'Turn on' : 'Verify'}
        </Button>
      </div>

      {mode === 'required' && (
        <button
          type="button"
          className="text-accent hover:text-accent-hover text-[12.5px] font-medium"
          onClick={() => {
            setUseRecovery((v) => !v)
            setCode('')
            setError(null)
          }}
        >
          {useRecovery ? 'Use the authenticator code instead' : 'Use a recovery code'}
        </button>
      )}
    </form>
  )
}
