import { useState } from 'react'
import { Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Field, Input, StatusBadge, Textarea } from '@/components/ui'
import { DIFFICULTIES, QUESTION_TYPES } from '../labels'
import { orderQuestions, parseList, type Difficulty, type InterviewDetail, type InterviewQuestion, type QuestionType } from '../types'
import { describeError, useInterviewActions } from '../useInterviews'

const SELECT =
  'border-line-strong bg-card text-ink h-10 w-full rounded-md border px-2 text-[14px] focus:border-accent focus:outline-none'

/**
 * The interview's controlled question bank (Phase 7A): primary questions in the order sessions ask
 * them, each with at most one follow-up. "Expected concepts" and "competency" are notes for future
 * evaluation (Phase 7B) — candidates never see them, and Phase 7A does not check answers against them.
 */
export function QuestionsSection({ interview, onChanged }: { interview: InterviewDetail; onChanged(): void }) {
  const actions = useInterviewActions()
  const editable = interview.status === 'DRAFT'
  const ordered = orderQuestions(interview.questions)
  const [adding, setAdding] = useState(false)
  const [followUpFor, setFollowUpFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      onChanged()
      return true
    } catch (err) {
      setError(describeError(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const move = (index: number, delta: number) => {
    const ids = ordered.map((row) => row.primary.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(index + delta, 0, moved!)
    void run(() => actions.reorder(interview.id, ids), 'Could not reorder the questions.')
  }

  return (
    <Card>
      <CardHeader
        title="Questions"
        description={`${interview.eligible_question_count} eligible for this configuration · ${interview.question_count} asked per session`}
        actions={editable && !adding && <Button size="sm" onClick={() => setAdding(true)}>Add question</Button>}
      />
      <CardBody className="space-y-3">
        {error && (
          <p className="bg-danger-soft text-danger rounded-md px-3 py-2 text-[13px]" role="alert">
            {error}
          </p>
        )}
        {adding && (
          <QuestionEditor
            topics={interview.topics}
            busy={busy}
            onCancel={() => setAdding(false)}
            onSave={async (input) => {
              if (await run(() => actions.addQuestion(interview.id, input), 'Could not add the question.')) setAdding(false)
            }}
          />
        )}
        {ordered.length === 0 && !adding && (
          <EmptyState title="No questions yet" description="Add the questions this interview may ask." />
        )}
        <ol className="space-y-2" aria-label="Interview questions">
          {ordered.map(({ primary, followUp }, index) => (
            <li key={primary.id} className="border-line rounded-md border p-3">
              <QuestionRow question={primary} number={index + 1} />
              {followUp && (
                <div className="border-accent mt-2 ml-4 border-l-2 pl-3">
                  <QuestionRow question={followUp} />
                </div>
              )}
              {followUpFor === primary.id && (
                <div className="mt-2 ml-4">
                  <FollowUpEditor
                    busy={busy}
                    onCancel={() => setFollowUpFor(null)}
                    onSave={async (input) => {
                      if (await run(() => actions.addFollowUp(interview.id, primary.id, input), 'Could not add the follow-up.')) {
                        setFollowUpFor(null)
                      }
                    }}
                  />
                </div>
              )}
              {editable && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" disabled={busy || index === 0} onClick={() => move(index, -1)}>
                    Move up
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy || index === ordered.length - 1} onClick={() => move(index, 1)}>
                    Move down
                  </Button>
                  {!followUp && followUpFor !== primary.id && (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setFollowUpFor(primary.id)}>
                      Add follow-up
                    </Button>
                  )}
                  {followUp && (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => actions.removeQuestion(interview.id, followUp.id), 'Could not remove the follow-up.')}>
                      Remove follow-up
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(() => actions.updateQuestion(interview.id, primary.id, { is_active: !primary.is_active }), 'Could not update the question.')}
                  >
                    {primary.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => actions.removeQuestion(interview.id, primary.id), 'Could not delete the question.')}>
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  )
}

function QuestionRow({ question, number }: { question: InterviewQuestion; number?: number }) {
  return (
    <div className="space-y-1 text-[13px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-ink-subtle text-[12px] font-medium">{number ? `Q${number}` : 'Follow-up'}</span>
        <StatusBadge>{question.topic}</StatusBadge>
        <StatusBadge>{QUESTION_TYPES[question.question_type]}</StatusBadge>
        <StatusBadge>{DIFFICULTIES[question.difficulty]}</StatusBadge>
        {!question.is_active && <StatusBadge tone="warn">Inactive</StatusBadge>}
      </div>
      <p className="text-ink whitespace-pre-wrap">{question.text}</p>
      {question.context && <p className="text-ink-muted text-[12.5px] whitespace-pre-wrap">Context: {question.context}</p>}
      {(question.expected_concepts.length > 0 || question.competency) && (
        <p className="text-ink-subtle text-[12px]">
          For future evaluation (hidden from candidates):{' '}
          {[question.competency && `competency — ${question.competency}`, question.expected_concepts.length && `expected — ${question.expected_concepts.join(', ')}`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}

function QuestionEditor({
  topics,
  busy,
  onSave,
  onCancel,
}: {
  topics: string[]
  busy: boolean
  onSave(input: Parameters<ReturnType<typeof useInterviewActions>['addQuestion']>[1]): void
  onCancel(): void
}) {
  const [text, setText] = useState('')
  const [questionType, setQuestionType] = useState<QuestionType>('TECHNICAL')
  const [topic, setTopic] = useState(topics[0] ?? '')
  const [difficulty, setDifficulty] = useState<Difficulty>('EASY')
  const [concepts, setConcepts] = useState('')
  const [competency, setCompetency] = useState('')
  const [context, setContext] = useState('')
  const [minutes, setMinutes] = useState('')
  const valid = text.trim() && topic

  return (
    <div className="border-line bg-surface space-y-3 rounded-md border p-3" aria-label="New question">
      <Field label="Question">
        {({ id }) => <Textarea id={id} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Topic">
          {({ id }) => (
            <select id={id} className={SELECT} value={topic} onChange={(e) => setTopic(e.target.value)}>
              {topics.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Question type">
          {({ id }) => (
            <select id={id} className={SELECT} value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType)}>
              {Object.entries(QUESTION_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Question difficulty">
          {({ id }) => (
            <select id={id} className={SELECT} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              {Object.entries(DIFFICULTIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Scenario / context (optional)" hint="Shown to the candidate with the question.">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} value={context} onChange={(e) => setContext(e.target.value)} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expected concepts / response dimensions" hint="Comma-separated. Hidden from candidates; for future evaluation.">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={concepts} onChange={(e) => setConcepts(e.target.value)} />}
        </Field>
        <Field label="Competency (behavioral, optional)" hint="Hidden from candidates.">
          {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={competency} maxLength={120} onChange={(e) => setCompetency(e.target.value)} />}
        </Field>
      </div>
      <Field label="Suggested time (minutes, optional)" hint="Shown to the candidate as guidance; the interview deadline is what is enforced.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={60} value={minutes} onChange={(e) => setMinutes(e.target.value)} />}
      </Field>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!valid}
          loading={busy}
          onClick={() =>
            onSave({
              text: text.trim(),
              question_type: questionType,
              topic,
              difficulty,
              expected_concepts: parseList(concepts),
              competency: competency.trim() || null,
              context: context.trim() || null,
              time_limit_seconds: minutes ? Number(minutes) * 60 : null,
              is_active: true,
            })
          }
        >
          Save question
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function FollowUpEditor({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean
  onSave(input: { text: string; expected_concepts: string[]; time_limit_seconds: number | null; is_active: boolean }): void
  onCancel(): void
}) {
  const [text, setText] = useState('')
  const [concepts, setConcepts] = useState('')
  const [active, setActive] = useState(true)
  return (
    <div className="border-line bg-surface space-y-3 rounded-md border p-3" aria-label="New follow-up">
      <Field label="Follow-up question" hint="Asked after this question is answered, while the follow-up limit allows. It takes the question's topic, type and difficulty.">
        {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} />}
      </Field>
      <Field label="Expected concepts (optional)" hint="Hidden from candidates.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={concepts} onChange={(e) => setConcepts(e.target.value)} />}
      </Field>
      <Checkbox label="Active" checked={active} onChange={(e) => setActive(e.target.checked)} />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!text.trim()}
          loading={busy}
          onClick={() => onSave({ text: text.trim(), expected_concepts: parseList(concepts), time_limit_seconds: null, is_active: active })}
        >
          Save follow-up
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
