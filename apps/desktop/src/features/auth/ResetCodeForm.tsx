import { useState, type FormEvent } from 'react'
import { AlertIcon } from '@/components/icons'
import { Button, Field, Input, PasswordInput } from '@/components/ui'
import { apiRequest, ApiError } from '@/lib/api'
import { Captcha } from './Captcha'
import { useLoginChallenge } from './useLoginChallenge'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMPTY = { email: '', code: '', password: '', confirm: '', captcha: '' }

function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return error.message
    switch (error.code) {
      case 'invalid_credentials':
        return 'That reset code is not valid or has expired. Ask your administrator for a new one.'
      case 'challenge_invalid':
        return 'The security check did not match. Try the new one.'
      case 'too_many_attempts':
      case 'server_busy':
      case 'validation_error':
        return error.message
      default:
        return 'Password reset is unavailable right now. Please try again shortly.'
    }
  }
  return 'Password reset failed. Please try again.'
}

/**
 * Sets a new password with a one-time code an administrator issued (Phase 8A, AX-06). There is no
 * self-service email reset in this build: the code comes from the administrator, works once, expires,
 * and every session of the account ends when it is used.
 */
export function ResetCodeForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { challenge, loading, error: challengeError, refresh } = useLoginChallenge()
  const [values, setValues] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = (key: keyof typeof EMPTY) => (value: string) => setValues((v) => ({ ...v, [key]: value }))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!EMAIL_PATTERN.test(values.email.trim())) return setError('Enter the email address of your account.')
    if (values.code.trim().length < 6) return setError('Enter the reset code from your administrator.')
    if (values.password.length < 8) return setError('Use at least 8 characters for the new password.')
    if (values.password !== values.confirm) return setError('The new passwords do not match.')
    if (!challenge || !values.captcha.trim()) return setError('Complete the security check.')

    setSubmitting(true)
    try {
      await apiRequest<void>('/api/v1/auth/password-reset', {
        method: 'POST',
        body: {
          email: values.email.trim(),
          code: values.code.trim().toUpperCase(),
          new_password: values.password,
          challenge_id: challenge.id,
          challenge_answer: values.captcha.trim(),
        },
      })
      onDone()
    } catch (failure) {
      setError(describe(failure))
      // Every attempt spends the challenge server-side.
      setValues((v) => ({ ...v, captcha: '' }))
      void refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Reset password with a code">
      <div>
        <h2 className="text-ink text-[15px] font-semibold">Reset your password</h2>
        <p className="text-ink-muted mt-1 text-[13px]">Use the one-time code your administrator gave you.</p>
      </div>
      {error && (
        <div className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
          <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
          {error}
        </div>
      )}
      <Field label="Email">
        {({ id }) => <Input id={id} type="email" autoComplete="email" autoFocus value={values.email} onChange={(e) => set('email')(e.target.value)} disabled={submitting} />}
      </Field>
      <Field label="Reset code">
        {({ id }) => (
          <Input id={id} autoComplete="off" placeholder="XXXXXX-XXXXXX-XXXXXX" className="font-mono tracking-wide" value={values.code} onChange={(e) => set('code')(e.target.value.toUpperCase())} disabled={submitting} />
        )}
      </Field>
      <Field label="New password" hint="At least 8 characters.">
        {({ id, describedBy }) => (
          <PasswordInput id={id} autoComplete="new-password" value={values.password} onChange={(e) => set('password')(e.target.value)} aria-describedby={describedBy} disabled={submitting} />
        )}
      </Field>
      <Field label="Confirm new password">
        {({ id }) => <PasswordInput id={id} autoComplete="new-password" value={values.confirm} onChange={(e) => set('confirm')(e.target.value)} disabled={submitting} />}
      </Field>
      <Captcha
        challenge={challenge}
        loading={loading}
        loadError={challengeError}
        onRefresh={() => {
          set('captcha')('')
          void refresh()
        }}
        value={values.captcha}
        onChange={set('captcha')}
        disabled={submitting}
      />
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={submitting}>
          Back to sign-in
        </Button>
        <Button type="submit" className="flex-1" loading={submitting}>
          Set new password
        </Button>
      </div>
    </form>
  )
}
