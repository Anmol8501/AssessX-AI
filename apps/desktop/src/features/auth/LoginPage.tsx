import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { homeFor, routes } from '@/app/routes'
import { AlertIcon, ArrowLeftIcon, InfoIcon } from '@/components/icons'
import { Button, Card, Checkbox, Field, Input, PasswordInput } from '@/components/ui'
import { useSession, type Credentials } from '@/features/session'
import { ApiError } from '@/lib/api'
import { AccountTypeSwitch, type AccountType } from './AccountTypeSwitch'
import { Captcha } from './Captcha'
import { ResetCodeForm } from './ResetCodeForm'
import { SecondFactorStep } from './SecondFactorStep'
import { SecurityShowcase } from './SecurityShowcase'
import { useLoginChallenge } from './useLoginChallenge'

interface FormErrors {
  rollNumber?: string
  username?: string
  email?: string
  password?: string
  captcha?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface FormValues {
  rollNumber: string
  username: string
  email: string
  password: string
  captcha: string
}

function validate(type: AccountType, v: FormValues, hasChallenge: boolean): FormErrors {
  const errors: FormErrors = {}
  if (type === 'candidate' && !v.rollNumber.trim()) errors.rollNumber = 'Enter your university roll number.'
  if (type === 'admin' && !v.username.trim()) errors.username = 'Enter your username.'
  if (!v.email.trim()) errors.email = 'Enter your email address.'
  else if (!EMAIL_PATTERN.test(v.email.trim())) errors.email = 'Enter a valid email address.'
  if (!v.password) errors.password = 'Enter your password.'
  if (!hasChallenge) errors.captcha = 'The security check is not available. Try refreshing it.'
  else if (!v.captcha.trim()) errors.captcha = 'Enter the verification code.'
  return errors
}

/** Turns an API failure into what the user should see. Never echoes server internals. */
function describeSignInError(error: unknown): { field?: keyof FormErrors; message: string } {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return { message: error.message }
    switch (error.code) {
      case 'invalid_credentials':
        return { message: 'The details you entered do not match an account. Check them and try again.' }
      case 'account_inactive':
        return { message: 'This account is inactive. Contact your administrator.' }
      case 'challenge_invalid':
        return { field: 'captcha', message: 'The code did not match. Try the new one.' }
      case 'too_many_attempts':
      case 'server_busy':
        // The server's own wording says how long to wait (Phase 8A).
        return { message: error.message }
      case 'validation_error':
        return { message: 'Please check the details you entered.' }
      default:
        return { message: 'Sign-in is unavailable right now. Please try again shortly.' }
    }
  }
  return { message: 'Sign-in failed. Please try again.' }
}

const EMPTY: FormValues = { rollNumber: '', username: '', email: '', password: '', captcha: '' }

export function LoginPage() {
  const navigate = useNavigate()
  const { state, signIn, signOut, completeSecondFactor } = useSession()
  const { challenge, loading: challengeLoading, error: challengeError, refresh: refreshChallenge } = useLoginChallenge()

  const [type, setType] = useState<AccountType>('candidate')
  const [values, setValues] = useState<FormValues>(EMPTY)
  const [remember, setRemember] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showResetHint, setShowResetHint] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetDone, setResetDone] = useState(false)

  const set = (key: keyof FormValues) => (value: string) => setValues((v) => ({ ...v, [key]: value }))

  const signedOutNotice =
    state.status === 'anonymous' && state.reason === 'expired' ? 'Your session has expired. Please sign in again.' : null

  function switchType(next: AccountType) {
    setType(next)
    setErrors({})
    setFormError(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    const nextErrors = validate(type, values, Boolean(challenge))
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const shared = {
      email: values.email.trim(),
      password: values.password,
      challengeId: challenge!.id,
      challengeAnswer: values.captcha.trim(),
      remember,
    }
    const credentials: Credentials =
      type === 'candidate'
        ? { kind: 'candidate', rollNumber: values.rollNumber.trim(), ...shared }
        : { kind: 'admin', username: values.username.trim(), ...shared }

    setSubmitting(true)
    try {
      const signed = await signIn(credentials)
      // An administrator may still need the second factor: the screen switches to that step.
      if (signed.mfa === 'none') navigate(homeFor(signed.user.role), { replace: true })
    } catch (error) {
      const described = describeSignInError(error)
      if (described.field) setErrors({ [described.field]: described.message })
      else setFormError(described.message)
      // Every attempt spends the challenge server-side, so fetch a new one.
      setValues((v) => ({ ...v, captcha: '' }))
      void refreshChallenge()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-surface grid h-full w-full grid-cols-[1.15fr_1fr] overflow-hidden">
      <SecurityShowcase />

      <div className="scrollbar-none relative flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto">
        <div className="flex flex-1 flex-col items-center justify-center px-8 py-8">
          <div className="enter w-full max-w-[420px]">
            <div className="mb-5">
              <h1 className="text-ink text-[24px] font-semibold tracking-[-0.01em]">Welcome back</h1>
              <p className="text-ink-muted mt-1 text-[14px]">
                {type === 'candidate' ? 'Sign in with the details your institution gave you.' : 'Administrator sign-in.'}
              </p>
            </div>

            {resetDone && !formError && (
              <Notice tone="info" role="status">
                Your password has been changed. Sign in with the new password.
              </Notice>
            )}

            {signedOutNotice && !formError && !resetDone && (
              <Notice tone="info" role="status">
                {signedOutNotice}
              </Notice>
            )}

            <Card className="p-6">
              {state.status === 'second-factor' ? (
                <SecondFactorStep
                  mode={state.mfa}
                  onDone={() => {
                    completeSecondFactor()
                    navigate(homeFor(state.user.role), { replace: true })
                  }}
                  onCancel={() => void signOut()}
                />
              ) : resetting ? (
                <ResetCodeForm
                  onCancel={() => {
                    setResetting(false)
                    void refreshChallenge()
                  }}
                  onDone={() => {
                    setResetting(false)
                    setShowResetHint(false)
                    setResetDone(true)
                    setValues((v) => ({ ...v, password: '', captcha: '' }))
                    void refreshChallenge()
                  }}
                />
              ) : (
              <>
              <AccountTypeSwitch value={type} onChange={switchType} disabled={submitting} />

              <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4" aria-label={`${type} sign-in`}>
                {formError && (
                  <Notice tone="danger" role="alert">
                    {formError}
                  </Notice>
                )}

                {type === 'candidate' ? (
                  <Field label="University roll number" error={errors.rollNumber}>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        name="rollNumber"
                        autoComplete="off"
                        autoFocus
                        placeholder="e.g. 2026CS0123"
                        value={values.rollNumber}
                        onChange={(e) => set('rollNumber')(e.target.value.toUpperCase())}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        disabled={submitting}
                        className="font-mono tracking-wide"
                      />
                    )}
                  </Field>
                ) : (
                  <Field label="Username" error={errors.username}>
                    {({ id, describedBy, invalid }) => (
                      <Input
                        id={id}
                        name="username"
                        autoComplete="username"
                        autoFocus
                        placeholder="your.username"
                        value={values.username}
                        onChange={(e) => set('username')(e.target.value)}
                        aria-describedby={describedBy}
                        invalid={invalid}
                        disabled={submitting}
                      />
                    )}
                  </Field>
                )}

                <Field label="Email" error={errors.email}>
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      type="email"
                      name="email"
                      autoComplete="email"
                      placeholder="you@organisation.edu"
                      value={values.email}
                      onChange={(e) => set('email')(e.target.value)}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      disabled={submitting}
                    />
                  )}
                </Field>

                <Field
                  label="Password"
                  error={errors.password}
                  labelAction={
                    <button
                      type="button"
                      onClick={() => setShowResetHint((v) => !v)}
                      className="text-accent hover:text-accent-hover text-[12.5px] font-medium"
                      aria-expanded={showResetHint}
                    >
                      Forgot password?
                    </button>
                  }
                >
                  {({ id, describedBy, invalid }) => (
                    <PasswordInput
                      id={id}
                      name="password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={values.password}
                      onChange={(e) => set('password')(e.target.value)}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      disabled={submitting}
                    />
                  )}
                </Field>

                {showResetHint && (
                  <p className="text-ink-subtle text-[12.5px]">
                    Ask your organisation's administrator for a one-time reset code, then{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setResetDone(false)
                        setResetting(true)
                      }}
                      className="text-accent hover:text-accent-hover font-medium"
                    >
                      enter the reset code
                    </button>
                    .
                  </p>
                )}

                <Captcha
                  challenge={challenge}
                  loading={challengeLoading}
                  loadError={challengeError}
                  onRefresh={() => {
                    set('captcha')('')
                    void refreshChallenge()
                  }}
                  value={values.captcha}
                  onChange={set('captcha')}
                  error={errors.captcha}
                  disabled={submitting}
                />

                <Checkbox
                  label="Keep me signed in on this device"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  disabled={submitting}
                />

                <Button type="submit" className="w-full" size="lg" loading={submitting}>
                  {type === 'candidate' ? 'Sign in as Candidate' : 'Sign in as Administrator'}
                </Button>
              </form>
              </>
              )}
            </Card>

            <p className="text-ink-subtle mt-5 text-center text-[13px]">
              Accounts are created by your institution. <span className="text-ink font-medium">No account? Contact your administrator.</span>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between px-8 py-4">
          <Link to={routes.welcome} className="text-ink-subtle hover:text-ink inline-flex items-center gap-1.5 text-[13px]">
            <ArrowLeftIcon className="text-[15px]" />
            Back
          </Link>
          <span className="text-ink-subtle text-[12px]">AssessX Desktop</span>
        </div>
      </div>
    </div>
  )
}

function Notice({ tone, role, children }: { tone: 'info' | 'danger'; role: 'status' | 'alert'; children: ReactNode }) {
  const Icon = tone === 'info' ? InfoIcon : AlertIcon
  return (
    <div
      className={
        tone === 'info'
          ? 'border-info/30 bg-info-soft text-info mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]'
          : 'border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]'
      }
      role={role}
    >
      <Icon className="mt-0.5 shrink-0 text-[15px]" />
      {children}
    </div>
  )
}
