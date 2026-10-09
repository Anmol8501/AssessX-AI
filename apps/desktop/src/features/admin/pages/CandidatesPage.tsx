import { useEffect, useState, type FormEvent } from 'react'
import { AlertIcon, CandidatesIcon } from '@/components/icons'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  LoadMore,
  PageHeader,
  PasswordInput,
  StatusBadge,
} from '@/components/ui'
import { useApi, usePagedList } from '@/features/session'
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

type CandidateAction = 'deactivate' | 'reactivate' | 'revoke-sessions' | 'reset-code'

const ACTION_COPY: Record<CandidateAction, { title: string; description: string; confirm: string; danger?: boolean }> = {
  deactivate: {
    title: 'Deactivate this candidate?',
    description: 'They are signed out everywhere and cannot sign in until reactivated. Their results are kept.',
    confirm: 'Deactivate',
    danger: true,
  },
  reactivate: { title: 'Reactivate this candidate?', description: 'They can sign in again with their current password.', confirm: 'Reactivate' },
  'revoke-sessions': {
    title: 'Sign this candidate out everywhere?',
    description: 'Every session of the account ends. An exam in progress can be resumed after signing in again.',
    confirm: 'Sign out everywhere',
  },
  'reset-code': {
    title: 'Issue a password reset code?',
    description:
      'Creates a one-time code the candidate uses on the sign-in screen (“I have a reset code”) to choose a new password. Any earlier code stops working. The code is shown once — pass it on privately.',
    confirm: 'Issue code',
  },
}


/**
 * Demo candidates for this showcase build: real CANDIDATE accounts created by an administrator.
 * There is no institutional directory, import or invitation email — the admin sets the initial
 * password and passes it on.
 */
export function CandidatesPage() {
  const api = useApi()
  const { createCandidate } = useAssessmentActions()
  // The list is paged, so finding someone beyond the first page needs a server-side search.
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])
  const { state, reload: load, hasMore, loadMore, loadingMore } = usePagedList<CandidateSummary>(
    query ? `/api/v1/candidates?q=${encodeURIComponent(query)}` : '/api/v1/candidates',
    'Could not load candidates.',
  )
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [pending, setPending] = useState<{ action: CandidateAction; candidate: CandidateSummary } | null>(null)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ name: string; code: string; expires_at: string } | null>(null)

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
      // Show the new row: in a paged list sorted by name it may not be on the first page.
      const email = values.email.trim()
      setValues(EMPTY)
      setShowForm(false)
      setSearch(email)
      if (query === email) await load()
      else setQuery(email)
    } catch (error) {
      setFormError(describeError(error, 'Could not create the candidate.'))
    } finally {
      setSubmitting(false)
    }
  }

  // Account controls for an administrator (Phase 8A, AX-06). Every action is audited server-side; a
  // reset code is shown once here and never stored or logged in readable form.
  async function handleAction() {
    if (!pending) return
    const { action, candidate } = pending
    setActing(true)
    setActionError(null)
    try {
      if (action === 'reset-code') {
        const result = await api<{ code: string; expires_at: string }>(`/api/v1/candidates/${candidate.id}/reset-code`, { method: 'POST' })
        setIssued({ name: candidate.name, ...result })
      } else {
        await api<unknown>(`/api/v1/candidates/${candidate.id}/${action}`, { method: 'POST' })
        setNotice(
          action === 'deactivate'
            ? `${candidate.name} is deactivated and signed out everywhere.`
            : action === 'reactivate'
              ? `${candidate.name} can sign in again.`
              : `${candidate.name} is signed out everywhere.`,
        )
      }
      setPending(null)
      await load()
    } catch (error) {
      setActionError(describeError(error, 'That did not work. Try again.'))
    } finally {
      setActing(false)
    }
  }

  const ask = (action: CandidateAction, candidate: CandidateSummary) => {
    setNotice(null)
    setActionError(null)
    setPending({ action, candidate })
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

      <div className="mb-4">
        <Input
          type="search"
          aria-label="Search candidates"
          placeholder="Search by name, email or roll number"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

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
        (state.data.length === 0 && query ? (
          <Card>
            <EmptyState title="No matching candidates" description={`Nobody's name, email or roll number contains "${query}".`} />
          </Card>
        ) : state.data.length === 0 ? (
          <Card>
            <EmptyState
              title="No candidates yet"
              description="Add a demo candidate to assign assessments to."
              action={<Button onClick={() => setShowForm(true)}>+ Add Candidate</Button>}
            />
          </Card>
        ) : (
          <Card>
            <CardHeader title={`${state.data.length}${hasMore ? '+' : ''} candidate(s)${query ? ' found' : ''}`} />
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
                    {candidate.is_active ? (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => ask('reset-code', candidate)}>
                          Reset code
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => ask('revoke-sessions', candidate)}>
                          Sign out
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => ask('deactivate', candidate)}>
                          Deactivate
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => ask('reactivate', candidate)}>
                        Reactivate
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <LoadMore hasMore={hasMore} loading={loadingMore} onClick={() => void loadMore()} />
          </Card>
        ))}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? ACTION_COPY[pending.action].title : ''}
        description={pending ? `${pending.candidate.name} — ${ACTION_COPY[pending.action].description}` : undefined}
        confirmLabel={pending ? ACTION_COPY[pending.action].confirm : 'Confirm'}
        confirmVariant={pending && ACTION_COPY[pending.action].danger ? 'danger' : 'primary'}
        busy={acting}
        onConfirm={() => void handleAction()}
        onCancel={() => setPending(null)}
      >
        {actionError && (
          <div className="border-danger/30 bg-danger-soft text-danger mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
            <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
            {actionError}
          </div>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={issued !== null}
        title="Reset code issued"
        description={issued ? `Give this code to ${issued.name}. It works once and expires at ${new Date(issued.expires_at).toLocaleTimeString()}. It will not be shown again.` : undefined}
        confirmLabel="Done"
        cancelLabel="Close"
        onConfirm={() => setIssued(null)}
        onCancel={() => setIssued(null)}
      >
        {issued && (
          <p className="border-line bg-surface text-ink mt-4 rounded-md border px-3 py-2.5 text-center font-mono text-[16px] tracking-wider select-all">{issued.code}</p>
        )}
      </ConfirmDialog>
    </>
  )
}
