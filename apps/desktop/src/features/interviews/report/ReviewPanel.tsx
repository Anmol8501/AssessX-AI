import { useState } from 'react'
import { Button, ConfirmDialog, Field, RadioGroup, StatusBadge, Textarea } from '@/components/ui'
import { historyLabel, outcomeLabel, reviewStatusLabel } from './labels'
import type { InterviewReport, ReviewOutcome } from './types'
import type { useInterviewReport } from './useReport'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '')

/**
 * "Human review" (Phase 7C) — everything here is written by a person. The outcome is chosen explicitly
 * (nothing is pre-selected, nothing comes from the AI score) and confirmed before it is recorded. Each
 * decision shows the AI figures it was made on, labelled as such, beside the human outcome.
 */
export function ReviewPanel({ report, actions }: { report: InterviewReport; actions: ReturnType<typeof useInterviewReport> }) {
  const review = report.review
  const status = reviewStatusLabel(review.status)
  const [revising, setRevising] = useState(false)

  return (
    <section className="border-line bg-card space-y-4 rounded-lg border p-4" aria-label="Human review">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-ink text-[14px] font-semibold">Human review</h2>
          <p className="text-ink-subtle text-[11.5px]">Human-authored · recorded with your name and the server time</p>
        </div>
        <StatusBadge tone={status.tone} dot>
          {status.label}
        </StatusBadge>
      </div>

      {actions.notice && (
        <p className="bg-warn-soft text-warn rounded-md px-3 py-2 text-[12.5px]" role="alert">
          {actions.notice}
        </p>
      )}

      {review.status === 'UNREVIEWED' ? (
        <Button onClick={() => void actions.start()} loading={actions.busy}>
          Start review
        </Button>
      ) : (
        <>
          <p className="text-ink-subtle text-[12px]">
            Started by {review.started_by?.name} · {when(review.started_at)}
          </p>
          {review.decisions[0] && (
            <div className="bg-surface rounded-md p-3 text-[12.5px]" data-review="outcome">
              <p className="text-ink-subtle text-[11px] uppercase">Human review outcome</p>
              <StatusBadge tone={outcomeLabel(review.decisions[0].outcome).tone} className="mt-1">
                {outcomeLabel(review.decisions[0].outcome).label}
              </StatusBadge>
              <p className="text-ink mt-2 whitespace-pre-wrap">{review.decisions[0].rationale}</p>
              <p className="text-ink-subtle mt-1 text-[11px]">
                {review.decisions[0].decided_by.name} · {when(review.decisions[0].decided_at)} · revision {review.decisions[0].revision} ·
                AI score then {review.decisions[0].basis.ai_score ?? '—'}
                {review.decisions[0].basis.ai_score_partial ? ' (partial)' : ''} (AI-generated)
              </p>
            </div>
          )}
          <Notes report={report} actions={actions} />
          {review.status === 'IN_REVIEW' && <Decision report={report} actions={actions} verb="complete" />}
          {review.status === 'REVIEWED' && !revising && (
            <Button variant="secondary" size="sm" onClick={() => setRevising(true)}>
              Revise outcome
            </Button>
          )}
          {review.status === 'REVIEWED' && revising && (
            <Decision report={report} actions={actions} verb="revise" onDone={() => setRevising(false)} />
          )}
          {review.decisions.length > 1 && (
            <div>
              <h3 className="text-ink text-[13px] font-semibold">Earlier decisions</h3>
              <ul className="mt-1 space-y-1 text-[12px]" aria-label="Earlier decisions">
                {review.decisions.slice(1).map((d) => (
                  <li key={d.revision} className="text-ink-muted">
                    Revision {d.revision}: {outcomeLabel(d.outcome).label} — superseded · {d.decided_by.name} · {when(d.decided_at)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {review.history.length > 0 && (
        <details>
          <summary className="text-ink cursor-pointer text-[13px] font-semibold">Review history ({review.history.length})</summary>
          <ol className="mt-1 space-y-1 text-[12px]" aria-label="Review history">
            {review.history.map((h, i) => (
              <li key={`${h.occurred_at}-${i}`} className="text-ink-muted">
                {when(h.occurred_at)} · {h.actor.name} — {historyLabel(h.action, h.details)}
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="text-ink-subtle text-[11.5px]">{review.note}</p>
    </section>
  )
}

function Notes({ report, actions }: { report: InterviewReport; actions: ReturnType<typeof useInterviewReport> }) {
  const [draft, setDraft] = useState('')
  return (
    <div>
      <h3 className="text-ink text-[13px] font-semibold">Human review notes</h3>
      {report.review.notes.length === 0 ? (
        <p className="text-ink-subtle text-[12px]">No notes yet.</p>
      ) : (
        <ul className="mt-1 space-y-2" aria-label="Human review notes">
          {report.review.notes.map((n) => (
            <li key={n.note_id} className="border-line rounded-md border px-3 py-2 text-[12.5px]">
              <p className="text-ink whitespace-pre-wrap">{n.body}</p>
              <p className="text-ink-subtle text-[11px]">
                {n.author.name} · {when(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 space-y-2">
        <Field label="Add a human review note" hint="Cannot be edited or deleted. Administrators only.">
          {({ id, describedBy }) => (
            <Textarea id={id} aria-describedby={describedBy} value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} />
          )}
        </Field>
        <Button
          size="sm"
          variant="secondary"
          disabled={!draft.trim() || actions.busy}
          onClick={async () => {
            if (await actions.addNote(draft.trim())) setDraft('')
          }}
        >
          Add note
        </Button>
      </div>
    </div>
  )
}

function Decision({
  report,
  actions,
  verb,
  onDone,
}: {
  report: InterviewReport
  actions: ReturnType<typeof useInterviewReport>
  verb: 'complete' | 'revise'
  onDone?(): void
}) {
  // Deliberately no default: the reviewer chooses; nothing is pre-selected from the AI score.
  const [outcome, setOutcome] = useState<ReviewOutcome | null>(null)
  const [rationale, setRationale] = useState('')
  const [confirming, setConfirming] = useState(false)
  const blocked = verb === 'complete' ? report.review.blocked_reason : null
  const options = report.review.outcome_options
    .filter((o) => verb === 'complete' || o.outcome !== report.review.outcome)
    .map((o) => ({ value: o.outcome, label: outcomeLabel(o.outcome).label, description: o.description }))
  const ready = outcome !== null && rationale.trim().length > 0 && !blocked

  return (
    <div className="border-line space-y-3 border-t pt-3" data-review="decision">
      <RadioGroup<ReviewOutcome> label="Human review outcome" name={`interview-outcome-${verb}`} options={options} value={outcome} onChange={setOutcome} disabled={actions.busy} />
      <Field label={verb === 'complete' ? 'Rationale' : 'Reason for the revision'} hint="Required. Recorded with the outcome.">
        {({ id, describedBy }) => (
          <Textarea id={id} aria-describedby={describedBy} value={rationale} maxLength={4000} onChange={(e) => setRationale(e.target.value)} />
        )}
      </Field>
      {blocked === 'INTERVIEW_IN_PROGRESS' && <p className="text-ink-subtle text-[12px]">The interview is still in progress. Record an outcome once it has ended.</p>}
      {blocked === 'EVALUATIONS_PENDING' && <p className="text-ink-subtle text-[12px]">Some answers are still being evaluated. Record an outcome once they finish.</p>}
      <div className="flex gap-2">
        <Button disabled={!ready} loading={actions.busy} onClick={() => setConfirming(true)}>
          {verb === 'complete' ? 'Complete review' : 'Record revision'}
        </Button>
        {onDone && (
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Record this human review outcome?"
        description={`"${outcome ? outcomeLabel(outcome).label : ''}" will be recorded as your administrative interpretation, with your name and the time. It is not an AI decision. It cannot be edited — only revised with a reason.`}
        confirmLabel="Record outcome"
        busy={actions.busy}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false)
          if (!outcome) return
          const ok = await (verb === 'complete' ? actions.complete(outcome, rationale.trim()) : actions.revise(outcome, rationale.trim()))
          if (ok) onDone?.()
        }}
      />
    </div>
  )
}
