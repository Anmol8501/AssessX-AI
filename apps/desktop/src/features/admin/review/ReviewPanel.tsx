import { useState } from 'react'
import { Button, Field, RadioGroup, StatusBadge, Textarea } from '@/components/ui'
import { riskLevel } from '../risk/labels'
import { dateTime, historyLabel, outcomeLabel, reviewStatusLabel } from './labels'
import type { AttemptReview, ReviewDecision, ReviewOutcome } from './types'
import type { useReview } from './useReview'

const MAX_TEXT = 4000

/**
 * "Administrative review" (Phase 6C) — everything on this panel is written by a person.
 *
 * Status, notes, the outcome and its rationale, earlier decisions and the review history. The
 * outcome is chosen here and only here; nothing pre-selects it from the risk level. Each recorded
 * decision shows the system's risk at that moment *next to* the human outcome, labelled as what the
 * reviewer saw — so "Risk High · Outcome Cleared" reads as two different things, which it is.
 */
export function ReviewPanel({ review, actions }: { review: AttemptReview; actions: ReturnType<typeof useReview> }) {
  const status = reviewStatusLabel(review.status)
  const current = review.decisions[0]
  const [revising, setRevising] = useState(false)

  return (
    <section className="border-line rounded-md border p-4" aria-label="Administrative review">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-ink text-[14px] font-semibold">Administrative review</h2>
          <p className="text-ink-subtle text-[11.5px]">Human-authored · recorded with your name and the server time</p>
        </div>
        <StatusBadge tone={status.tone} dot>
          {status.label}
        </StatusBadge>
      </div>

      {actions.notice && (
        <p className="bg-warn-soft text-warn mt-3 rounded-md px-3 py-2 text-[12.5px]" role="alert">
          {actions.notice}
        </p>
      )}

      {review.status === 'UNREVIEWED' && (
        <div className="mt-3 space-y-2">
          <p className="text-ink-muted text-[13px]">
            No one has reviewed this attempt yet. Starting the review records you as its reviewer.
          </p>
          <Button onClick={() => void actions.start()} loading={actions.busy}>
            Start review
          </Button>
        </div>
      )}

      {review.status !== 'UNREVIEWED' && (
        <>
          <p className="text-ink-subtle mt-2 text-[12px]">
            Started by {review.startedBy?.name} · {dateTime(review.startedAt)}
          </p>

          {current && <CurrentOutcome decision={current} />}

          <Notes review={review} actions={actions} />

          {review.status === 'IN_REVIEW' && (
            <DecisionForm
              key={`complete-${review.version}`}
              review={review}
              submitLabel="Complete review"
              onSubmit={actions.complete}
              busy={actions.busy}
            />
          )}

          {review.status === 'REVIEWED' && !revising && (
            <div className="mt-3">
              <Button variant="secondary" size="sm" onClick={() => setRevising(true)}>
                Revise outcome
              </Button>
              <p className="text-ink-subtle mt-1 text-[11.5px]">
                A revision is recorded as a new decision; the earlier one stays in the record.
              </p>
            </div>
          )}
          {review.status === 'REVIEWED' && revising && (
            <DecisionForm
              key={`revise-${review.version}`}
              review={review}
              submitLabel="Record revision"
              rationaleLabel="Reason for the revision"
              exclude={review.outcome}
              onSubmit={async (outcome, rationale) => {
                if (await actions.revise(outcome, rationale)) setRevising(false)
              }}
              onCancel={() => setRevising(false)}
              busy={actions.busy}
            />
          )}

          {review.decisions.length > 1 && <EarlierDecisions decisions={review.decisions.slice(1)} />}
          <History review={review} />
        </>
      )}

      <p className="text-ink-subtle mt-4 text-[11.5px]">{review.interpretation}</p>
    </section>
  )
}

function CurrentOutcome({ decision }: { decision: ReviewDecision }) {
  const outcome = outcomeLabel(decision.outcome)
  const risk = riskLevel(decision.basis.riskLevel)
  return (
    <div className="border-line bg-surface mt-3 rounded-md border p-3" data-review="outcome">
      <div className="grid grid-cols-2 gap-3 text-[12.5px]">
        <div>
          <p className="text-ink-subtle text-[11px] tracking-wide uppercase">Administrative outcome · human</p>
          <StatusBadge tone={outcome.tone} className="mt-1">
            {outcome.label}
          </StatusBadge>
        </div>
        <div>
          <p className="text-ink-subtle text-[11px] tracking-wide uppercase">Risk signal at decision · system</p>
          <StatusBadge tone={risk.tone} dot className="mt-1">
            {risk.label} · {decision.basis.riskScore}/100
          </StatusBadge>
        </div>
      </div>
      <p className="text-ink mt-2 text-[12.5px] whitespace-pre-wrap">{decision.rationale}</p>
      <p className="text-ink-subtle mt-1 text-[11.5px]">
        {decision.decidedBy.name} · {dateTime(decision.decidedAt)} · revision {decision.revision} · {decision.basis.evidenceCount}{' '}
        evidence items · policy {decision.basis.policyVersion}
      </p>
    </div>
  )
}

function Notes({ review, actions }: { review: AttemptReview; actions: ReturnType<typeof useReview> }) {
  const [draft, setDraft] = useState('')
  const text = draft.trim()

  return (
    <div className="mt-4">
      <h3 className="text-ink text-[13px] font-semibold">Review notes</h3>
      {review.notes.length === 0 ? (
        <p className="text-ink-subtle mt-1 text-[12px]">No notes yet.</p>
      ) : (
        <ul className="mt-2 space-y-2" aria-label="Review notes">
          {review.notes.map((note) => (
            <li key={note.noteId} className="border-line rounded-md border px-3 py-2">
              <p className="text-ink text-[12.5px] whitespace-pre-wrap">{note.body}</p>
              <p className="text-ink-subtle mt-1 text-[11px]">
                {note.author.name} · {dateTime(note.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 space-y-2">
        <Field label="Add a note" hint="Notes cannot be edited or deleted. They are visible to administrators only.">
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={draft}
              maxLength={MAX_TEXT}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What you checked and what you concluded."
            />
          )}
        </Field>
        <Button
          variant="secondary"
          size="sm"
          disabled={!text || actions.busy}
          onClick={async () => {
            if (await actions.addNote(text)) setDraft('')
          }}
        >
          Add note
        </Button>
      </div>
    </div>
  )
}

function DecisionForm({
  review,
  submitLabel,
  rationaleLabel = 'Rationale',
  exclude,
  onSubmit,
  onCancel,
  busy,
}: {
  review: AttemptReview
  submitLabel: string
  rationaleLabel?: string
  exclude?: ReviewOutcome | null
  onSubmit(outcome: ReviewOutcome, rationale: string): Promise<unknown>
  onCancel?(): void
  busy: boolean
}) {
  // Deliberately no default: the administrator chooses, nothing is pre-selected from the risk.
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null)
  const [rationale, setRationale] = useState('')
  const options = review.outcomeOptions
    .filter((o) => o.outcome !== exclude)
    .map((o) => ({ value: o.outcome, label: outcomeLabel(o.outcome).label, description: o.description }))
  const ready = outcome !== null && rationale.trim().length > 0 && review.canComplete

  return (
    <div className="border-line mt-4 space-y-3 border-t pt-4" data-review="decision">
      <RadioGroup<ReviewOutcome> label="Administrative outcome" name={`outcome-${submitLabel}`} options={options} value={outcome} onChange={setOutcome} disabled={busy} />
      <Field label={rationaleLabel} hint="Required. Recorded with the outcome and shown in the review history.">
        {({ id, describedBy }) => (
          <Textarea id={id} aria-describedby={describedBy} value={rationale} maxLength={MAX_TEXT} onChange={(e) => setRationale(e.target.value)} />
        )}
      </Field>
      {!review.canComplete && (
        <p className="text-ink-subtle text-[12px]">The attempt is still in progress. An outcome can be recorded once it is submitted or has expired.</p>
      )}
      <div className="flex gap-2">
        <Button disabled={!ready} loading={busy} onClick={() => outcome && void onSubmit(outcome, rationale.trim())}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

function EarlierDecisions({ decisions }: { decisions: ReviewDecision[] }) {
  return (
    <div className="mt-4">
      <h3 className="text-ink text-[13px] font-semibold">Earlier decisions</h3>
      <ul className="mt-2 space-y-2" aria-label="Earlier decisions">
        {decisions.map((d) => (
          <li key={d.revision} className="border-line rounded-md border px-3 py-2 text-[12px]">
            <p className="text-ink">
              Revision {d.revision}: <span className="font-medium">{outcomeLabel(d.outcome).label}</span> — superseded
            </p>
            <p className="text-ink-muted whitespace-pre-wrap">{d.rationale}</p>
            <p className="text-ink-subtle text-[11px]">
              {d.decidedBy.name} · {dateTime(d.decidedAt)} · risk then {riskLevel(d.basis.riskLevel).label} ({d.basis.riskScore})
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function History({ review }: { review: AttemptReview }) {
  if (review.history.length === 0) return null
  return (
    <details className="mt-4">
      <summary className="text-ink cursor-pointer text-[13px] font-semibold">Review history ({review.history.length})</summary>
      <ol className="mt-2 space-y-1 text-[12px]" aria-label="Review history">
        {review.history.map((entry, index) => (
          <li key={`${entry.occurredAt}-${index}`} className="text-ink-muted">
            <span className="text-ink-subtle tabular-nums">{dateTime(entry.occurredAt)}</span> · {entry.actor.name} —{' '}
            {historyLabel(entry.action, entry.details)}
          </li>
        ))}
      </ol>
    </details>
  )
}
