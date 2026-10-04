import { Card, CardBody, CardHeader, ErrorState, LoadingState } from '@/components/ui'
import { formatPercentage } from '@/features/exam/useResults'
import { LANGUAGE_NAME, VERDICT_LABEL } from '../types'
import { useCodingAnalytics } from '../useCoding'

const cell = 'px-4 py-2.5 text-[13px] tabular-nums'
const head = 'px-4 py-2.5 font-medium'

function average(value: string | null, maximum: number | null): string {
  if (value === null) return '—'
  const shown = String(Number(Number(value).toFixed(2)))
  return maximum === null ? shown : `${shown} / ${maximum}`
}

function languages(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  return entries.length ? entries.map(([id, n]) => `${LANGUAGE_NAME[id] ?? id} ${n}`).join(', ') : '—'
}

/**
 * Coding analytics for one assessment (stage C4): per problem, per candidate and by section.
 *
 * Facts computed by the server from stored submissions — counts, rates, averages, verdicts. Candidates
 * are listed by name, never ranked, and nothing here is a judgement about anyone. Hidden for an
 * assessment without coding questions.
 */
export function CodingAnalyticsPanel({ assessmentId }: { assessmentId: string }) {
  const { state, reload } = useCodingAnalytics(assessmentId)

  if (state.status === 'loading') {
    return (
      <Card className="mt-6">
        <LoadingState title="Loading coding analytics…" />
      </Card>
    )
  }
  if (state.status === 'error') {
    return (
      <Card className="mt-6">
        <ErrorState title="Could not load the coding analytics" description={state.message} onRetry={() => void reload()} />
      </Card>
    )
  }
  const { questions, candidates, summary } = state.data
  if (questions.length === 0) return null

  return (
    <section className="mt-6 space-y-4" aria-label="Coding analytics">
      <Card>
        <CardHeader title="Coding analytics" description="Facts from the stored submissions. Candidates are listed by name, not ranked." />
        <CardBody className="grid grid-cols-3 gap-4 text-center">
          {summary.mcq_maximum !== null && (
            <Average label="Average multiple choice" value={average(summary.mcq_average, summary.mcq_maximum)} />
          )}
          <Average label="Average coding" value={average(summary.coding_average, summary.coding_maximum)} />
          <Average label="Average total" value={average(summary.total_average, summary.total_maximum)} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="By problem" />
        <CardBody className="overflow-x-auto px-0 py-0">
          <table className="w-full text-left" aria-label="Problems">
            <thead>
              <tr className="border-line text-ink-subtle border-b text-[12px] tracking-wide uppercase">
                <th scope="col" className={head}>
                  Problem
                </th>
                <th scope="col" className={head}>
                  Candidates
                </th>
                <th scope="col" className={head}>
                  Submissions
                </th>
                <th scope="col" className={head}>
                  Accepted
                </th>
                <th scope="col" className={head}>
                  Solved
                </th>
                <th scope="col" className={head}>
                  Average marks
                </th>
                <th scope="col" className={head}>
                  Average runtime
                </th>
                <th scope="col" className={head}>
                  Languages
                </th>
                <th scope="col" className={head}>
                  Most common failure
                </th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {questions.map((q) => (
                <tr key={q.question_id}>
                  <td className="text-ink px-4 py-2.5 text-[13px]">
                    <span className="font-medium">Q{q.number}</span> · {q.title}
                  </td>
                  <td className={cell}>{q.candidates_attempted}</td>
                  <td className={cell}>{q.submissions}</td>
                  <td className={cell}>{formatPercentage(q.acceptance_rate)}</td>
                  <td className={cell}>{formatPercentage(q.solved_rate)}</td>
                  <td className={cell}>{average(q.average_score, q.marks)}</td>
                  <td className={cell}>
                    {q.average_runtime_ms === null ? '—' : `${Math.round(Number(q.average_runtime_ms))} ms`}
                  </td>
                  <td className="text-ink-subtle px-4 py-2.5 text-[12.5px]">{languages(q.languages)}</td>
                  <td className="text-ink-subtle px-4 py-2.5 text-[12.5px]">
                    {q.common_failure ? (VERDICT_LABEL[q.common_failure] ?? q.common_failure) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {candidates.length > 0 && (
        <Card>
          <CardHeader title="By candidate" />
          <CardBody className="overflow-x-auto px-0 py-0">
            <table className="w-full text-left" aria-label="Coding by candidate">
              <thead>
                <tr className="border-line text-ink-subtle border-b text-[12px] tracking-wide uppercase">
                  <th scope="col" className={head}>
                    Candidate
                  </th>
                  <th scope="col" className={head}>
                    Problems tried
                  </th>
                  <th scope="col" className={head}>
                    Submissions
                  </th>
                  <th scope="col" className={head}>
                    Accepted
                  </th>
                  <th scope="col" className={head}>
                    Languages
                  </th>
                  <th scope="col" className={head}>
                    Coding marks
                  </th>
                  <th scope="col" className={head}>
                    Best per problem
                  </th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {candidates.map((c) => (
                  <tr key={c.attempt_id}>
                    <td className="text-ink px-4 py-2.5 text-[13px]">
                      {c.candidate_name}
                      {c.attempt_number > 1 && <span className="text-ink-subtle"> · attempt {c.attempt_number}</span>}
                    </td>
                    <td className={cell}>
                      {c.problems_attempted} / {questions.length}
                    </td>
                    <td className={cell}>{c.submissions}</td>
                    <td className={cell}>{formatPercentage(c.pass_rate)}</td>
                    <td className="text-ink-subtle px-4 py-2.5 text-[12.5px]">
                      {c.languages.map((id) => LANGUAGE_NAME[id] ?? id).join(', ')}
                    </td>
                    <td className={cell}>
                      {c.coding_maximum === null ? 'Being evaluated' : `${c.coding_score} / ${c.coding_maximum}`}
                    </td>
                    <td className="text-ink-subtle px-4 py-2.5 text-[12.5px]">
                      {c.problems.map((p, i) => (
                        <span key={p.question_id} className="block">
                          Q{questions[i]?.number ?? i + 1}: {bestText(p)}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </section>
  )
}

function bestText(p: { submissions: number; best_verdict: string | null; best_passed: number | null; total: number | null }) {
  if (p.best_verdict) return `${VERDICT_LABEL[p.best_verdict] ?? p.best_verdict} (${p.best_passed ?? 0}/${p.total ?? 0})`
  return p.submissions > 0 ? 'Not judged' : 'Not tried'
}

function Average({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-ink-subtle text-[12px]">{label}</p>
      <p className="text-ink mt-0.5 text-[18px] font-semibold tabular-nums">{value}</p>
    </div>
  )
}
