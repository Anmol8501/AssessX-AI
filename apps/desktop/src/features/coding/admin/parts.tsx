import { StatusBadge, type StatusTone } from '@/components/ui'
import { DIFFICULTY_LABEL, type CodingProblemForCandidate, type Difficulty } from '../types'

export const SELECT =
  'border-line-strong bg-card text-ink h-10 w-full rounded-md border px-2 text-[14px] focus:border-accent focus:ring-accent-ring focus:outline-none focus:ring-2 disabled:bg-surface'

export const MONO_AREA =
  'border-line-strong bg-card text-ink w-full rounded-md border px-3 py-2 font-mono text-[12.5px] leading-relaxed focus:border-accent focus:outline-none disabled:bg-surface'

const TONE: Record<Difficulty, StatusTone> = { EASY: 'ok', MEDIUM: 'warn', HARD: 'danger' }

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <StatusBadge tone={TONE[difficulty]}>{DIFFICULTY_LABEL[difficulty]}</StatusBadge>
}

function Section({ title, text }: { title: string; text: string | null }) {
  if (!text?.trim()) return null
  return (
    <section className="mt-4">
      <h3 className="text-ink text-[13px] font-semibold">{title}</h3>
      <p className="text-ink-muted mt-1 text-[13px] whitespace-pre-wrap">{text}</p>
    </section>
  )
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-ink-subtle text-[11.5px] font-medium tracking-wide uppercase">{label}</p>
      <pre className="bg-surface border-line mt-0.5 overflow-x-auto rounded border px-2.5 py-1.5 font-mono text-[12.5px] whitespace-pre-wrap">{value || ' '}</pre>
    </div>
  )
}

/**
 * The problem as a candidate will read it — rendered from `CodingProblemForCandidate`, the same shape the
 * candidate API returns, so the preview cannot show anything a candidate would not see.
 */
export function ProblemStatement({ problem }: { problem: CodingProblemForCandidate }) {
  return (
    <article aria-label="Problem statement">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-ink text-[17px] font-semibold">{problem.title}</h2>
        <DifficultyBadge difficulty={problem.difficulty} />
        {problem.tags.map((tag) => (
          <span key={tag} className="bg-surface text-ink-muted rounded px-1.5 py-0.5 text-[11.5px]">
            {tag}
          </span>
        ))}
      </div>
      <p className="text-ink mt-3 text-[13.5px] leading-relaxed whitespace-pre-wrap">{problem.statement}</p>
      <Section title="Input format" text={problem.input_format} />
      <Section title="Output format" text={problem.output_format} />
      <Section title="Constraints" text={problem.constraints} />
      {problem.examples.map((example, i) => (
        <section key={i} className="mt-4 space-y-1.5">
          <h3 className="text-ink text-[13px] font-semibold">Example {i + 1}</h3>
          <Block label="Input" value={example.input} />
          <Block label="Output" value={example.output} />
          {example.explanation && <p className="text-ink-muted text-[12.5px]">{example.explanation}</p>}
        </section>
      ))}
      {problem.sample_tests.length > 0 && (
        <section className="mt-4 space-y-2">
          <h3 className="text-ink text-[13px] font-semibold">Sample tests</h3>
          {problem.sample_tests.map((test) => (
            <div key={test.number} className="grid gap-2 sm:grid-cols-2">
              <Block label={`Sample ${test.number} input`} value={test.input} />
              <Block label="Expected output" value={test.expected_output} />
            </div>
          ))}
        </section>
      )}
      <p className="text-ink-subtle mt-4 text-[12px]">
        {problem.languages.map((l) => `${l.name} ${l.version}`).join(' · ')} · {problem.time_limit_ms} ms · {problem.memory_limit_mb} MB ·{' '}
        {problem.hidden_test_count} hidden test{problem.hidden_test_count === 1 ? '' : 's'}
      </p>
    </article>
  )
}
