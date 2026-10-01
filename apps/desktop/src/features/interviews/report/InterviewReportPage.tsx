import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { ArrowLeftIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, ErrorState, InfoList, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import { DIFFICULTIES, INTERVIEW_TYPES, QUESTION_TYPES, completionLabel } from '../labels'
import { AiEvaluation } from './AiEvaluation'
import { answerStateLabel, decisionReason, evaluationStateLabel, minutes, reviewStatusLabel } from './labels'
import { ReviewPanel } from './ReviewPanel'
import type { InterviewReport, ReportQuestion } from './types'
import { useInterviewReport } from './useReport'

const humanize = (key: string) => key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

/**
 * Interview report (Phase 7C): what was asked, what the candidate answered, what the AI evaluation said
 * (labelled as an AI-generated signal), how the interview adapted, and the human review — kept visibly
 * apart. Every figure is the server's; this screen computes nothing authoritative. Text is rendered as
 * text, never as HTML.
 */
export function InterviewReportPage() {
  const { interviewId = '', sessionId = '' } = useParams()
  const navigate = useNavigate()
  const report = useInterviewReport(interviewId, sessionId)
  const { state } = report
  const back = (
    <Button variant="ghost" onClick={() => navigate(routes.admin.interviewReports)} leadingIcon={<ArrowLeftIcon />}>
      Reports
    </Button>
  )

  if (state.status === 'loading') {
    return (
      <>
        <PageHeader title="Interview report" actions={back} />
        <Card>
          <LoadingState title="Loading the report…" />
        </Card>
      </>
    )
  }
  if (state.status === 'error') {
    return (
      <>
        <PageHeader title="Interview report" actions={back} />
        <Card>
          <ErrorState title="Could not load the report" description={state.message} onRetry={() => void report.reload()} />
        </Card>
      </>
    )
  }

  const r = state.data
  const review = reviewStatusLabel(r.review.status)
  return (
    <>
      <PageHeader
        title={r.candidate.name}
        description={`${r.interview.title} · ${r.candidate.roll_number ?? r.candidate.email}`}
        actions={back}
      />
      <Card className="mb-4">
        <CardBody>
          <InfoList
            items={[
              { label: 'Interview', value: r.session.status === 'COMPLETED' ? `Completed — ${completionLabel(r.session.completion_reason).toLowerCase()}` : 'In progress' },
              { label: 'AI evaluation', value: evaluationStateLabel(r.summary.evaluation_state) },
              { label: 'Human review', value: review.label },
              { label: 'Type · difficulty', value: `${INTERVIEW_TYPES[r.interview.interview_type]} · up to ${DIFFICULTIES[r.interview.difficulty]}${r.interview.adaptive_difficulty ? ' (adaptive)' : ''}` },
              { label: 'Started · ended', value: `${when(r.session.started_at)} · ${when(r.session.completed_at)}` },
              { label: 'Duration', value: minutes(r.summary.duration_seconds) },
            ]}
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Summary report={r} />
          <Topics report={r} />
          <Questions report={r} onMark={report.mark} editable={r.review.status === 'IN_REVIEW'} busy={report.busy} />
          <Timeline report={r} />
          <Card>
            <CardHeader title="Proctoring" />
            <CardBody>
              <p className="text-ink-muted text-[13px]">{r.proctoring.note}</p>
            </CardBody>
          </Card>
        </div>
        <div>
          <ReviewPanel report={r} actions={report} />
        </div>
      </div>
    </>
  )
}

function Summary({ report: r }: { report: InterviewReport }) {
  const s = r.summary
  return (
    <Card aria-label="AI evaluation summary">
      <CardHeader title="AI evaluation summary" description="AI-generated assessment signal" />
      <CardBody className="space-y-3 text-[13px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="AI assessment score" value={s.ai_score === null ? '—' : `${s.ai_score} / 100`} hint={s.ai_score_partial ? 'Partial — not every answer was evaluated' : undefined} />
          <Figure label="Evaluated" value={`${s.evaluated_primaries} of ${s.answered_primaries} answers`} />
          <Figure label="Completion" value={`${s.completion_percent}%`} hint={`${s.answered_primaries} of ${s.planned_primaries} questions answered`} />
          <Figure label="Follow-ups" value={`${s.follow_ups_answered} of ${s.follow_ups_asked}`} />
        </div>
        {Object.entries(s.dimension_means).map(([rubric, dims]) => (
          <p key={rubric} className="text-ink-muted text-[12.5px]">
            {rubric}: {Object.entries(dims).map(([k, v]) => `${humanize(k)} ${v}`).join(' · ')}
          </p>
        ))}
        <p className="text-ink-subtle text-[11.5px]">
          {s.models.join(', ') || 'No model'} · evaluator {s.evaluator_versions.join(', ') || '—'} · rubric {s.rubric_versions.join(', ') || '—'} · report policy {s.report_policy_version}
        </p>
        <p className="text-ink-subtle text-[11.5px]">{s.note}</p>
      </CardBody>
    </Card>
  )
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-ink-subtle text-[11px] tracking-wide uppercase">{label}</p>
      <p className="text-ink text-[16px] font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-ink-subtle text-[11px]">{hint}</p>}
    </div>
  )
}

function Topics({ report: r }: { report: InterviewReport }) {
  if (r.topics.length === 0) return null
  return (
    <Card>
      <CardHeader title="Topics" description="AI assessment by configured topic (evaluated primary answers)" />
      <CardBody>
        <table className="w-full text-left text-[12.5px]" aria-label="Topic analysis">
          <thead>
            <tr className="text-ink-subtle text-[11px] uppercase">
              <th className="py-1 font-medium">Topic</th>
              <th className="py-1 font-medium">Answered</th>
              <th className="py-1 font-medium">AI score</th>
              <th className="py-1 font-medium">Often not covered</th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {r.topics.map((t) => (
              <tr key={t.topic}>
                <td className="text-ink py-1.5 font-medium">{t.topic}</td>
                <td className="py-1.5 tabular-nums">
                  {t.answered} / {t.asked}
                </td>
                <td className="py-1.5 tabular-nums">{t.ai_score === null ? '—' : t.ai_score}</td>
                <td className="text-ink-muted py-1.5">{t.common_missing.map(([c, n]) => `${c} (${n})`).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  )
}

function Questions({
  report: r,
  onMark,
  editable,
  busy,
}: {
  report: InterviewReport
  onMark(itemId: string, mark: 'AGREE' | 'DISAGREE'): Promise<boolean>
  editable: boolean
  busy: boolean
}) {
  return (
    <Card>
      <CardHeader title="Questions and answers" />
      <CardBody>
        <ol className="space-y-4" aria-label="Question analysis">
          {r.questions.map((q) => (
            <QuestionBlock key={q.item_id} q={q} onMark={onMark} editable={editable} busy={busy} />
          ))}
        </ol>
      </CardBody>
    </Card>
  )
}

function QuestionBlock({
  q,
  onMark,
  editable,
  busy,
}: {
  q: ReportQuestion
  onMark(itemId: string, mark: 'AGREE' | 'DISAGREE'): Promise<boolean>
  editable: boolean
  busy: boolean
}) {
  const state = answerStateLabel(q.answer_state)
  return (
    <li className="border-line border-t pt-3 text-[13px] first:border-t-0 first:pt-0" data-report="question">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-ink font-semibold">{q.kind === 'FOLLOW_UP' ? `Follow-up to Q${q.number}` : `Q${q.number}`}</span>
        <StatusBadge>{q.topic}</StatusBadge>
        <StatusBadge>{QUESTION_TYPES[q.question_type]}</StatusBadge>
        <StatusBadge>{DIFFICULTIES[q.difficulty]}</StatusBadge>
        <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
      </div>
      <p className="text-ink mt-1 whitespace-pre-wrap">{q.question_text}</p>
      {q.expected_concepts.length > 0 && (
        <p className="text-ink-subtle text-[11.5px]">Expected concepts (rubric context): {q.expected_concepts.join(', ')}</p>
      )}
      <p className="text-ink-subtle mt-1.5 text-[11px] uppercase">Candidate answer {q.answered_at ? `· ${new Date(q.answered_at).toLocaleTimeString()}` : ''}</p>
      <p className="text-ink-muted whitespace-pre-wrap" data-report="answer">
        {q.answer_text ?? 'Not answered.'}
      </p>
      {q.evaluation && <AiEvaluation evaluation={q.evaluation} />}
      {(q.review_mark || (editable && q.answer_state === 'EVALUATED')) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2" data-report="human-mark">
          <span className="text-ink-subtle text-[11.5px]">Human review of this AI evaluation:</span>
          {q.review_mark && (
            <StatusBadge tone={q.review_mark.mark === 'AGREE' ? 'ok' : 'warn'}>
              {q.review_mark.mark === 'AGREE' ? 'Agrees' : 'Disagrees'} — {q.review_mark.marked_by.name}
            </StatusBadge>
          )}
          {editable && q.answer_state === 'EVALUATED' && (
            <>
              <Button size="sm" variant="secondary" disabled={busy} aria-pressed={q.review_mark?.mark === 'AGREE'} onClick={() => void onMark(q.item_id, 'AGREE')}>
                Agree
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} aria-pressed={q.review_mark?.mark === 'DISAGREE'} onClick={() => void onMark(q.item_id, 'DISAGREE')}>
                Disagree
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function Timeline({ report: r }: { report: InterviewReport }) {
  return (
    <Card>
      <CardHeader title="How the interview progressed" description="Recorded decisions of the adaptive policy — rules, not AI reasoning" />
      <CardBody>
        <ol className="space-y-1.5 text-[12.5px]" aria-label="Adaptive timeline">
          {r.timeline.map((t) => (
            <li key={t.sequence} className="text-ink-muted">
              <span className="text-ink font-medium">{t.kind === 'FOLLOW_UP' ? `Follow-up to Q${t.number}` : `Q${t.number}`}</span> · {t.topic} ·{' '}
              {DIFFICULTIES[t.difficulty]} · {answerStateLabel(t.answer_state).label}
              {t.ai_score !== null ? ` (AI ${t.ai_score})` : ''}
              {t.decision && <span className="text-ink-subtle"> → {decisionReason(t.decision.reason)}</span>}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  )
}
