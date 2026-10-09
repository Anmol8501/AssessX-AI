import { useState, type FormEvent } from 'react'
import { AlertIcon } from '@/components/icons'
import { Button, ConfirmDialog, Field, PasswordInput } from '@/components/ui'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi } from './useApi'
import { useCurrentUser, useSession } from './useSession'

interface AccountDialogProps {
  open: boolean
  onClose: () => void
}

const EMPTY = { current: '', next: '', confirm: '' }

/**
 * The signed-in user's own account security (Phase 8A, AX-06): change the password — which ends every
 * other session of the account — or sign out on every device at once (a lost or shared laptop).
 */
export function AccountDialog({ open, onClose }: AccountDialogProps) {
  const api = useApi()
  const user = useCurrentUser()
  const { signOut } = useSession()
  const [values, setValues] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmingEverywhere, setConfirmingEverywhere] = useState(false)

  const minimum = user.role === 'ADMIN' ? 12 : 8

  function close() {
    setValues(EMPTY)
    setError(null)
    setNotice(null)
    onClose()
  }

  async function handleChange(event?: FormEvent) {
    event?.preventDefault()
    setError(null)
    setNotice(null)
    if (!values.current) return setError('Enter your current password.')
    if (values.next.length < minimum) return setError(`Use at least ${minimum} characters for the new password.`)
    if (values.next.length > 128) return setError('Use at most 128 characters for the new password.')
    if (values.next !== values.confirm) return setError('The new passwords do not match.')
    setBusy(true)
    try {
      await api<void>('/api/v1/auth/password', {
        method: 'POST',
        body: { current_password: values.current, new_password: values.next },
      })
      setValues(EMPTY)
      setNotice('Password changed. You are still signed in here; every other device has been signed out.')
    } catch (failure) {
      setError(describeError(failure, 'Could not change the password.'))
    } finally {
      setBusy(false)
    }
  }

  async function handleSignOutEverywhere() {
    setBusy(true)
    try {
      await api<{ sessions_ended: number }>('/api/v1/auth/logout-all', { method: 'POST' })
      await signOut()
    } catch (failure) {
      setError(describeError(failure, 'Could not sign out everywhere.'))
      setConfirmingEverywhere(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <ConfirmDialog
        open={open && !confirmingEverywhere}
        title="Account security"
        description={`Signed in as ${user.email}.`}
        confirmLabel="Change password"
        cancelLabel="Close"
        busy={busy}
        onConfirm={() => void handleChange()}
        onCancel={close}
      >
        <form onSubmit={(event) => void handleChange(event)} noValidate className="mt-4 space-y-3" aria-label="Change password">
          {error && (
            <div className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
              <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
              {error}
            </div>
          )}
          {notice && (
            <div className="border-ok/30 bg-ok-soft text-ok rounded-md border px-3 py-2 text-[13px]" role="status">
              {notice}
            </div>
          )}
          <Field label="Current password">
            {({ id }) => (
              <PasswordInput id={id} autoComplete="current-password" value={values.current} onChange={(e) => setValues((v) => ({ ...v, current: e.target.value }))} disabled={busy} />
            )}
          </Field>
          <Field label="New password" hint={`${minimum}–128 characters.`}>
            {({ id, describedBy }) => (
              <PasswordInput id={id} autoComplete="new-password" value={values.next} onChange={(e) => setValues((v) => ({ ...v, next: e.target.value }))} aria-describedby={describedBy} disabled={busy} />
            )}
          </Field>
          <Field label="Confirm new password">
            {({ id }) => (
              <PasswordInput id={id} autoComplete="new-password" value={values.confirm} onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.value }))} disabled={busy} />
            )}
          </Field>
          {/* Lets Enter submit the form; the dialog's own button is the visible action. */}
          <button type="submit" hidden />
          <div className="border-line border-t pt-3">
            <p className="text-ink-muted text-[13px]">Lost a device, or signed in on a shared computer?</p>
            <Button variant="secondary" size="sm" className="mt-2" disabled={busy} onClick={() => setConfirmingEverywhere(true)}>
              Sign out everywhere
            </Button>
          </div>
        </form>
      </ConfirmDialog>

      <ConfirmDialog
        open={open && confirmingEverywhere}
        title="Sign out on every device?"
        description="Every session of this account ends, including this one. You will need to sign in again."
        confirmLabel="Sign out everywhere"
        confirmVariant="danger"
        busy={busy}
        onConfirm={() => void handleSignOutEverywhere()}
        onCancel={() => setConfirmingEverywhere(false)}
      />
    </>
  )
}
