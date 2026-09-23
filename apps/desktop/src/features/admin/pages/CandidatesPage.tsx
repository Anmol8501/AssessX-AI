import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertIcon, CandidatesIcon } from '@/components/icons'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  PasswordInput,
  StatusBadge,
} from '@/components/ui'
import { useApi } from '@/features/session'
import { describeError, useAssessmentActions } from '@/features/assessments/useAssessments'
import type { CandidateSummary } from '@/features/assessments/types'

interface Errors {
  name?: string
  email?: string
  roll_number?: string
  initial_password?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMPTY = { name: '', email: '', roll_number: '', initial_password: '' }

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: CandidateSummary[] }

/**
 * Demo candidates for this showcase build: real CANDIDATE accounts created by an administrator.
 * There is no institutional directory, import or invitation email — the admin sets the initial
 * password and passes it on.
 */
export function CandidatesPage() {
  const api = useApi()
  const { createCandidate } = useAssessmentActions()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(
    (signal?: AbortSignal) =>
      api<CandidateSummary[]>('/api/v1/candidates', { signal })
        .then((data) => {
          if (!signal?.aborted) setState({ status: 'ready', data })
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) setState({ status: 'error', message: describeError(error, 'Could not load candidates.') })
        }),
    [api],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  const set = (key: keyof typeof EMPTY) => (value: string) => setValues((v) => ({ ...v, [key]: value }))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    setNotice(null)

    const next: Errors = {}
    if (values.name.trim().length < 2) next.name = 'Enter the candidate’s full name.'
    if (!EMAIL_PATTERN.test(values.email.trim())) next.email = 'Enter a valid email address.'
    if (!values.roll_number.trim()) next.roll_number = 'Enter the university roll number.'
    if (values.initial_password.length < 8) next.initial_password = 'Use at least 8 characters.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      await createCandidate({
        name: values.name.trim(),
        email: values.email.trim(),
        roll_number: values.roll_number.trim(),
        initial_password: values.initial_password,
      })
      setNotice(`${values.name.trim()} can now sign in with their roll number and this password.`)
      setValues(EMPTY)
      setShowForm(false)
      await load()
    } catch (error) {
      setFormError(describeError(error, 'Could not create the candidate.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Candidates"
        description="Demo candidate accounts for this showcase. Assessments are assigned to them once published."
        actions={
          !showForm ? (
            <Button
              onClick={() => {
                setShowForm(true)
                setNotice(null)
              }}
            >
              + Add Candidate
            </Button>
          ) : undefined
        }
      />

      {notice && (
        <div className="border-ok/30 bg-ok-soft text-ok mb-4 rounded-md border px-3 py-2 text-[13px]" role="status">
          {notice}
        </div>
      )}

      {showForm && (
        <Card className="mb-4 max-w-2xl">
          <CardHeader title="Add candidate" description="Creates a CANDIDATE account. The role cannot be changed here." />
          <CardBody>
            <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Add candidate">
              {formError && (
                <div className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
                  <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <Field label="Full name" error={errors.name}>
                  {({ id, describedBy, invalid }) => (
                    <Input id={id} autoFocus value={values.name} onChange={(e) => set('name')(e.target.value)} aria-describedby={describedBy} invalid={invalid} disabled={submitting} />
                  )}
                </Field>
                <Field label="University roll number" error={errors.roll_number}>
                  {({ id, describedBy, invalid }) => (
                    <Input id={id} className="font-mono" value={values.roll_number} onChange={(e) => set('roll_number')(e.target.value.toUpperCase())} aria-describedby={describedBy} invalid={invalid} disabled={submitting} />
                  )}
                </Field>
              </div>

              <Field label="Email" error={errors.email}>
                {({ id, describedBy, invalid }) => (
                  <Input id={id} type="email" value={values.email} onChange={(e) => set('email')(e.target.value)} aria-describedby={describedBy} invalid={invalid} disabled={submitting} />
                )}
              </Field>

              <Field
                label="Initial password"
                error={errors.initial_password}
                hint="Share it with the candidate. There is no invitation email in this build."
              >
                {({ id, describedBy, invalid }) => (
                  <PasswordInput id={id} value={values.initial_password} onChange={(e) => set('initial_password')(e.target.value)} aria-describedby={describedBy} invalid={invalid} disabled={submitting} />
                )}
              </Field>

              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={submitting}
                  onClick={() => {
                    setShowForm(false)
                    setErrors({})
                    setFormError(null)
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={submitting}>
                  Create candidate
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {state.status === 'loading' && (
        <Card>
          <LoadingState title="Loading candidates…" />
        </Card>
      )}
      {state.status === 'error' && (
        <Card>
          <ErrorState title="Could not load candidates" description={state.message} onRetry={() => void load()} />
        </Card>
      )}
      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <Card>
            <EmptyState
              title="No candidates yet"
              description="Add a demo candidate to assign assessments to."
              action={<Button onClick={() => setShowForm(true)}>+ Add Candidate</Button>}
            />
          </Card>
        ) : (
          <Card>
            <CardHeader title={`${state.data.length} candidate(s)`} />
            <ul className="divide-line divide-y">
              {state.data.map((candidate) => (
                <li key={candidate.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="bg-accent-soft text-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px]">
                      <CandidatesIcon />
                    </span>
                    <div className="min-w-0">
                      <p className="text-ink truncate text-[14px] font-medium">{candidate.name}</p>
                      <p className="text-ink-subtle truncate text-[12.5px]">
                        {candidate.email}
                        {candidate.roll_number && <span className="font-mono"> · {candidate.roll_number}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-ink-subtle text-[12.5px]">
                      {candidate.assignment_count} assessment{candidate.assignment_count === 1 ? '' : 's'}
                    </span>
                    <StatusBadge tone={candidate.is_active ? 'ok' : 'warn'}>
                      {candidate.is_active ? 'Active' : 'Inactive'}
                    </StatusBadge>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
    </>
  )
}
