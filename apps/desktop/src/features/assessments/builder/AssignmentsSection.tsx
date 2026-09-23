import { useCallback, useEffect, useState } from 'react'
import { AlertIcon, CandidatesIcon, CheckIcon, InfoIcon } from '@/components/icons'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Input,
  LoadingState,
  StatusBadge,
} from '@/components/ui'
import { cn } from '@/lib/cn'
import type { AssessmentDetail, Assignment, CandidateSummary } from '../types'
import { describeError, useAssessmentActions } from '../useAssessments'

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString()
}

interface AssignmentsSectionProps {
  assessment: AssessmentDetail
  /** Refreshes the assessment so its assignment count stays in step. */
  onChanged(): void
}

/** Assign a published assessment to demo candidates, and see who already holds it. */
export function AssignmentsSection({ assessment, onChanged }: AssignmentsSectionProps) {
  const { listAssignments, listCandidates, assignCandidates, unassignCandidate } = useAssessmentActions()
  const [assignments, setAssignments] = useState<Assignment[] | null>(null)
  const [candidates, setCandidates] = useState<CandidateSummary[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<Assignment | null>(null)

  const published = assessment.status === 'PUBLISHED'

  const load = useCallback(
    () =>
      Promise.all([listAssignments(assessment.id), listCandidates()])
        .then(([rows, people]) => {
          setError(null)
          setAssignments(rows)
          setCandidates(people)
        })
        .catch((err: unknown) => {
          setError(describeError(err, 'Could not load assignments.'))
          setAssignments([])
          setCandidates([])
        }),
    [assessment.id, listAssignments, listCandidates],
  )

  useEffect(() => {
    void load()
  }, [load])

  if (!published) {
    return (
      <Card>
        <CardHeader title="Assign candidates" description="Available once the assessment is published." />
        <CardBody>
          <p className="text-ink-muted flex items-start gap-2 text-[13.5px]">
            <InfoIcon className="mt-0.5 shrink-0 text-[15px]" />
            Publish this assessment from the Review step, then come back to assign candidates.
          </p>
        </CardBody>
      </Card>
    )
  }

  if (assignments === null || candidates === null) {
    return (
      <Card>
        <LoadingState title="Loading assignments…" />
      </Card>
    )
  }

  const assignedIds = new Set(assignments.map((a) => a.candidate_id))
  const available = candidates.filter((candidate) => {
    if (assignedIds.has(candidate.id) || !candidate.is_active) return false
    const needle = search.trim().toLowerCase()
    return !needle || candidate.name.toLowerCase().includes(needle) || candidate.email.toLowerCase().includes(needle)
  })

  async function assign() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await assignCandidates(assessment.id, [...selected])
      const parts: string[] = []
      if (result.assigned.length) parts.push(`${result.assigned.length} candidate(s) assigned successfully.`)
      if (result.already_assigned.length) parts.push(`${result.already_assigned.length} already had it.`)
      setNotice(parts.join(' '))
      setSelected(new Set())
      await load()
      onChanged()
    } catch (err) {
      setError(describeError(err, 'Could not assign the candidates.'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!pendingRemove) return
    setBusy(true)
    try {
      await unassignCandidate(assessment.id, pendingRemove.candidate_id)
      setPendingRemove(null)
      setNotice(`${pendingRemove.candidate_name} was unassigned.`)
      await load()
      onChanged()
    } catch (err) {
      setError(describeError(err, 'Could not unassign the candidate.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
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

      <Card>
        <CardHeader
          title="Assigned candidates"
          description={`${assignments.length} candidate(s) hold this assessment.`}
        />
        {assignments.length === 0 ? (
          <EmptyState title="Nobody assigned yet" description="Select candidates below to assign this assessment." />
        ) : (
          <ul className="divide-line divide-y">
            {assignments.map((assignment) => (
              <li key={assignment.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-ink truncate text-[13.5px] font-medium">{assignment.candidate_name}</p>
                  <p className="text-ink-subtle truncate text-[12.5px]">
                    {assignment.candidate_email}
                    {assignment.candidate_roll_number && <span className="font-mono"> · {assignment.candidate_roll_number}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge tone="accent">{assignment.status}</StatusBadge>
                  <span className="text-ink-subtle text-[12.5px]">{formatDate(assignment.assigned_at)}</span>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPendingRemove(assignment)}>
                    Unassign
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Assign candidates"
          description="Only active candidates who do not already hold this assessment are listed."
          actions={
            <Button size="sm" disabled={selected.size === 0 || busy} loading={busy && selected.size > 0} onClick={assign}>
              Assign selected
            </Button>
          }
        />
        <CardBody className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidates…"
            aria-label="Search candidates"
          />

          {available.length === 0 ? (
            <p className="text-ink-subtle py-4 text-center text-[13px]">
              {candidates.length === 0 ? 'No candidates exist yet. Add some from the Candidates page.' : 'No candidates match.'}
            </p>
          ) : (
            <ul className="max-h-[320px] space-y-2 overflow-y-auto">
              {available.map((candidate) => {
                const checked = selected.has(candidate.id)
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      aria-label={`Select ${candidate.name}`}
                      onClick={() =>
                        setSelected((current) => {
                          const next = new Set(current)
                          if (next.has(candidate.id)) next.delete(candidate.id)
                          else next.add(candidate.id)
                          return next
                        })
                      }
                      className={cn(
                        'flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
                        checked ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong hover:bg-surface',
                      )}
                    >
                      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[13px]', checked ? 'border-accent bg-accent text-white' : 'border-line-strong text-transparent')}>
                        <CheckIcon />
                      </span>
                      <span className="bg-surface text-ink-subtle flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[15px]">
                        <CandidatesIcon />
                      </span>
                      <span className="min-w-0">
                        <span className="text-ink block truncate text-[13.5px] font-medium">{candidate.name}</span>
                        <span className="text-ink-subtle block truncate text-[12.5px]">{candidate.email}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <p className="text-ink-subtle text-[12.5px]" role="status">
            {selected.size} candidate{selected.size === 1 ? '' : 's'} selected
          </p>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Unassign candidate?"
        description={pendingRemove ? `${pendingRemove.candidate_name} will no longer see this assessment in My Exams.` : undefined}
        confirmLabel="Unassign"
        confirmVariant="danger"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  )
}
