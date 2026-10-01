import { StatusBadge } from '@/components/ui'
import type { InterviewEvaluation } from '../types'

const STATUS: Record<InterviewEvaluation['status'], { label: string; tone: 'ok' | 'warn' | 'neutral' | 'info' }> = {
  COMPLETED: { label: 'Evaluated', tone: 'ok' },
  PENDING: { label: 'Evaluating', tone: 'info' },
  FAILED: { label: 'Evaluation failed — no score', tone: 'warn' },
  UNAVAILABLE: { label: 'Not evaluated (no evaluator configured)', tone: 'neutral' },
}

const humanize = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/**
 * One answer's AI evaluation (Phase 7B), as the Phase 7C report shows it — an assessment signal for a
 * person to review: scores, findings, the model's own confidence (not a probability of being right), any
 * server warnings, and the model, evaluator, rubric and prompt versions. No reasoning trace exists to show.
 */
export function AiEvaluation({ evaluation: e }: { evaluation: InterviewEvaluation }) {
  const status = STATUS[e.status]
  return (
    <div className="bg-surface mt-2 space-y-1.5 rounded-md p-2.5" data-evaluation="result">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        {e.overall_score !== null && <span className="text-ink font-semibold tabular-nums">{e.overall_score} / 100</span>}
        {e.confidence !== null && <span className="text-ink-subtle text-[11.5px]">model confidence {e.confidence.toFixed(2)}</span>}
        {e.flags.map((flag) => (
          <StatusBadge key={flag} tone="warn">
            {humanize(flag.toLowerCase())}
          </StatusBadge>
        ))}
      </div>
      {e.dimension_scores && (
        <p className="text-ink-muted text-[12px]">
          {Object.entries(e.dimension_scores)
            .map(([k, v]) => `${humanize(k)} ${v}/10`)
            .join(' · ')}
        </p>
      )}
      {e.feedback && <p className="text-ink">{e.feedback}</p>}
      {e.strengths.length > 0 && <p className="text-ink-muted">Strengths: {e.strengths.join('; ')}</p>}
      {e.present_concepts.length > 0 && <p className="text-ink-muted">Covered: {e.present_concepts.join(', ')}</p>}
      {e.missing_concepts.length > 0 && <p className="text-ink-muted">Not covered: {e.missing_concepts.join(', ')}</p>}
      {e.incorrect_points.length > 0 && <p className="text-ink-muted">Incorrect: {e.incorrect_points.join('; ')}</p>}
      {e.evidence_quotes.length > 0 && <p className="text-ink-subtle">From the answer: “{e.evidence_quotes.join('” · “')}”</p>}
      {e.failure_reason && <p className="text-ink-subtle">Reason: {humanize(e.failure_reason.toLowerCase())}</p>}
      <p className="text-ink-subtle text-[11px]">
        {e.provider}/{e.model} · evaluator {e.evaluator_version} · rubric {e.rubric_version} · prompt {e.prompt_version}
      </p>
    </div>
  )
}
