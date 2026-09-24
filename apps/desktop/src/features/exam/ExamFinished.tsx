import { useNavigate } from 'react-router'
import { routes } from '@/app/routes'
import { CheckIcon, ClockIcon, InfoIcon } from '@/components/icons'
import { Button, Card, CardBody, ErrorState, LoadingState, StateView, StatusBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { OUTCOME_LABEL, type AttemptDetail, type CandidateResult, type QuestionResult } from './types'
import { formatPercentage, useAttemptResult } from './useResults'

/**
 * What the candidate sees once the attempt is over.
 *
 * It shows how the exam ended and, when the assessment is configured to release results, the
 * score. When it is not, the numbers are absent rather than zeroed — a withheld result and a
 * failed one must never look alike.
 *
 * Nothing here reveals which option was correct. The breakdown says how each question went, which
 * is the most the candidate is given.
 */
export function ExamFinished({ attempt }: { attempt: AttemptDetail }) {
  const navigate = useNavigate()
  const { state, reload } = useAttemptResult(attempt.id)
  const expired = attempt.status === 'TIME_EXPIRED'

  const back = <Button onClick={() => navigate(routes.candidate.exams)}>Back to My Exams</Button>

  if (state.status === 'loading') {
    return (
      <Centred>
        <LoadingState title="Working out your result…" layout="page" />
      </Centred>
    )
  }

  if (state.status === 'error') {
    return (
      <Centred>
        <ErrorState
          title={expired ? 'Exam time has ended.' : 'Exam submitted successfully.'}
          description={`Your answers were recorded. ${state.message}`}
          onRetry={() => void reload()}
        />
      </Centred>
    )
  }

  const result = state.data

  return (
    <div className="bg-surface flex h-full w-full items-start justify-center overflow-y-auto p-8">
      <Card className="w-full max-w-2xl">
        <div className="border-line border-b px-8 py-7 text-center">
          <div
            className={cn(
              'mx-auto flex h-11 w-11 items-center justify-center rounded-full border text-[22px]',
              expired ? 'border-line bg-surface text-ink-subtle' : 'border-ok/30 bg-ok-soft text-ok',
            )}
          >
            {expired ? <ClockIcon /> : <CheckIcon />}
          </div>
          <h1 className="text-ink mt-4 text-[18px] font-semibold">
            {expired ? 'Exam time has ended.' : 'Exam submitted successfully.'}
          </h1>
          <p className="text-ink-subtle mt-1 text-[13.5px]">
            {result.assessment_title} · attempt {result.attempt_number}
          </p>
        </div>

        {result.released ? <ReleasedResult result={result} /> : <WithheldResult expired={expired} />}

        <CardBody className="border-line flex justify-center border-t">{back}</CardBody>
      </Card>
    </div>
  )
}

function ReleasedResult({ result }: { result: CandidateResult }) {
  return (
    <>
      <div className="border-line grid grid-cols-2 border-b sm:grid-cols-4">
        <Figure label="Score" value={`${result.score} / ${result.maximum_score}`} />
        <Figure label="Percentage" value={formatPercentage(result.percentage)} />
        <Figure
          label="Result"
          value={result.passed ? 'Passed' : 'Failed'}
          tone={result.passed ? 'ok' : 'danger'}
        />
        <Figure label="Questions" value={`${result.questions.length}`} />
      </div>

      <CardBody className="space-y-5">
        <dl className="grid grid-cols-3 gap-4 text-center">
          <Count label="Correct" value={result.correct_count} className="text-ok" />
          <Count label="Incorrect" value={result.incorrect_count} className="text-danger" />
          <Count label="Unanswered" value={result.unanswered_count} className="text-ink-muted" />
        </dl>

        {result.questions.length > 0 && <Breakdown questions={result.questions} />}

        {result.evaluated_at && (
          <p className="text-ink-subtle text-center text-[12.5px]">
            Evaluated {new Date(result.evaluated_at).toLocaleString()}
          </p>
        )}
      </CardBody>
    </>
  )
}

function WithheldResult({ expired }: { expired: boolean }) {
  return (
    <CardBody>
      <StateView
        icon={<InfoIcon />}
        title="Your result is not being shown"
        description={`Your answers ${
          expired ? 'up to the moment time ran out ' : ''
        }have been recorded and marked. This exam is set not to show results to candidates, so your administrator will share them.`}
      />
    </CardBody>
  )
}

function Breakdown({ questions }: { questions: QuestionResult[] }) {
  return (
    <div>
      <h2 className="text-ink text-[13px] font-semibold">Question breakdown</h2>
      <ul className="border-line mt-2 divide-y rounded-md border">
        {questions.map((question) => (
          <li key={question.position} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <span className="text-ink text-[13.5px]">Question {question.position + 1}</span>
            <span className="flex items-center gap-3">
              <span className="text-ink-subtle text-[12.5px] tabular-nums">
                {question.marks_awarded} / {question.marks}
              </span>
              <StatusBadge
                tone={
                  question.outcome === 'CORRECT' ? 'ok' : question.outcome === 'INCORRECT' ? 'danger' : 'neutral'
                }
              >
                {OUTCOME_LABEL[question.outcome]}
              </StatusBadge>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  return (
    <div className="border-line border-r px-4 py-4 text-center last:border-r-0">
      <p className="text-ink-subtle text-[12px] tracking-wide uppercase">{label}</p>
      <p
        className={cn(
          'mt-1 text-[20px] leading-none font-semibold tabular-nums',
          tone === 'ok' ? 'text-ok' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function Count({ label, value, className }: { label: string; value: number | null; className: string }) {
  return (
    <div>
      <dt className="text-ink-subtle text-[12px]">{label}</dt>
      <dd className={cn('mt-0.5 text-[18px] font-semibold tabular-nums', className)}>{value ?? '—'}</dd>
    </div>
  )
}

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface flex h-full w-full items-center justify-center p-8">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  )
}
