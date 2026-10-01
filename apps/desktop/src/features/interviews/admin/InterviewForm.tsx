import { useState, type FormEvent } from 'react'
import { Button, Checkbox, Field, Input, Textarea } from '@/components/ui'
import { DIFFICULTIES, INTERVIEW_TYPES } from '../labels'
import { parseList, type Difficulty, type InterviewFormat, type InterviewInput, type InterviewType } from '../types'

const SELECT =
  'border-line-strong bg-card text-ink h-10 w-full rounded-md border px-2 text-[14px] focus:border-accent focus:ring-accent-ring focus:outline-none focus:ring-2 disabled:bg-surface'


/**
 * The interview's configuration. Values are validated again by the server, which is authoritative;
 * this form only keeps obviously invalid input from being sent.
 *
 * Phase 7D: a LIVE interview is a video call held by a person — its questions are the interviewer's
 * guide, so the AI-only settings (questions asked, follow-ups, adaptive difficulty) are hidden and sent
 * as neutral values.
 */
export function InterviewForm({
  initial,
  submitLabel,
  disabled,
  busy,
  error,
  onSubmit,
}: {
  initial: InterviewInput
  submitLabel: string
  disabled?: boolean
  busy?: boolean
  error?: string | null
  onSubmit(input: InterviewInput): void
}) {
  const [values, setValues] = useState(initial)
  const [topics, setTopics] = useState(initial.topics.join(', '))
  const set = <K extends keyof InterviewInput>(key: K, value: InterviewInput[K]) => setValues((v) => ({ ...v, [key]: value }))

  const parsedTopics = parseList(topics)
  const live = values.format === 'LIVE'
  const budgetTooHigh = !live && values.max_follow_ups > values.question_count
  const rank = { EASY: 1, MEDIUM: 2, HARD: 3 } as const
  const boundsInvalid =
    !live &&
    values.adaptive_difficulty &&
    !(rank[values.min_difficulty] <= rank[values.starting_difficulty] && rank[values.starting_difficulty] <= rank[values.difficulty])
  const valid = values.title.trim().length > 0 && parsedTopics.length > 0 && !budgetTooHigh && !boundsInvalid

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit({
      ...values,
      // Not adaptive: the bounds are irrelevant; keep them consistent with the maximum.
      ...(values.adaptive_difficulty ? {} : { min_difficulty: 'EASY' as const, starting_difficulty: values.difficulty }),
      // A live interview is held by a person: the AI-only settings are neutral.
      ...(live
        ? { follow_ups_enabled: false, max_follow_ups: 0, adaptive_difficulty: false, min_difficulty: 'EASY' as const, starting_difficulty: values.difficulty }
        : {}),
      title: values.title.trim(),
      description: values.description?.trim() || null,
      instructions: values.instructions?.trim() || null,
      topics: parsedTopics,
    })
  }

  return (
    <form className="space-y-4" onSubmit={submit} aria-label="Interview configuration">
      {error && (
        <p className="bg-danger-soft text-danger rounded-md px-3 py-2 text-[13px]" role="alert">
          {error}
        </p>
      )}
      <Field
        label="Format"
        hint={
          live
            ? 'A video call with an interviewer. The questions are the interviewer’s guide; nothing is recorded.'
            : 'The candidate answers in writing; answers are evaluated by AI for a person to review.'
        }
      >
        {({ id, describedBy }) => (
          <select id={id} aria-describedby={describedBy} className={SELECT} value={values.format} disabled={disabled} onChange={(e) => set('format', e.target.value as InterviewFormat)}>
            <option value="AI">AI interview (written answers)</option>
            <option value="LIVE">Live video interview</option>
          </select>
        )}
      </Field>
      <Field label="Title">
        {({ id }) => <Input id={id} value={values.title} maxLength={200} disabled={disabled} onChange={(e) => set('title', e.target.value)} />}
      </Field>
      <Field label="Description" hint="Shown to candidates in their interview list.">
        {({ id, describedBy }) => (
          <Textarea id={id} aria-describedby={describedBy} value={values.description ?? ''} disabled={disabled} onChange={(e) => set('description', e.target.value)} />
        )}
      </Field>
      <Field label="Instructions" hint={live ? 'Shown before the candidate joins the call.' : 'Shown before the candidate starts.'}>
        {({ id, describedBy }) => (
          <Textarea id={id} aria-describedby={describedBy} value={values.instructions ?? ''} disabled={disabled} onChange={(e) => set('instructions', e.target.value)} />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          {({ id }) => (
            <select id={id} className={SELECT} value={values.interview_type} disabled={disabled} onChange={(e) => set('interview_type', e.target.value as InterviewType)}>
              {Object.entries(INTERVIEW_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Difficulty (maximum)" hint="The hardest level a question may be.">
          {({ id, describedBy }) => (
            <select id={id} aria-describedby={describedBy} className={SELECT} value={values.difficulty} disabled={disabled} onChange={(e) => set('difficulty', e.target.value as Difficulty)}>
              {Object.entries(DIFFICULTIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Topics" hint="Comma-separated, e.g. Python, Data Structures, SQL. Questions must use one of these.">
        {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={topics} disabled={disabled} onChange={(e) => setTopics(e.target.value)} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={live ? 'Planned length (minutes)' : 'Duration (minutes)'}>
          {({ id }) => (
            <Input id={id} type="number" min={5} max={180} value={values.duration_minutes} disabled={disabled} onChange={(e) => set('duration_minutes', Number(e.target.value))} />
          )}
        </Field>
        {!live && (
          <>
            <Field label="Questions asked">
              {({ id }) => (
                <Input id={id} type="number" min={1} max={30} value={values.question_count} disabled={disabled} onChange={(e) => set('question_count', Number(e.target.value))} />
              )}
            </Field>
            <Field label="Follow-up limit" error={budgetTooHigh ? 'At most one follow-up per question.' : undefined}>
              {({ id }) => (
                <Input id={id} type="number" min={0} max={30} value={values.max_follow_ups} disabled={disabled || !values.follow_ups_enabled} onChange={(e) => set('max_follow_ups', Number(e.target.value))} />
              )}
            </Field>
          </>
        )}
      </div>
      {!live && (
        <>
          <Checkbox
            label="Adapt difficulty to the answers (AI evaluation; one level at a time, within the range)"
            checked={values.adaptive_difficulty}
            disabled={disabled}
            onChange={(e) => set('adaptive_difficulty', e.target.checked)}
          />
          {values.adaptive_difficulty && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Minimum difficulty">
                {({ id }) => (
                  <select id={id} className={SELECT} value={values.min_difficulty} disabled={disabled} onChange={(e) => set('min_difficulty', e.target.value as Difficulty)}>
                    {Object.entries(DIFFICULTIES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Starting difficulty" error={boundsInvalid ? 'Minimum ≤ starting ≤ maximum.' : undefined}>
                {({ id }) => (
                  <select id={id} className={SELECT} value={values.starting_difficulty} disabled={disabled} onChange={(e) => set('starting_difficulty', e.target.value as Difficulty)}>
                    {Object.entries(DIFFICULTIES).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          )}
          <Checkbox
            label="Ask configured follow-up questions (at most one per question)"
            checked={values.follow_ups_enabled}
            disabled={disabled}
            onChange={(e) => set('follow_ups_enabled', e.target.checked)}
          />
        </>
      )}
      {!disabled && (
        <Button type="submit" disabled={!valid} loading={busy}>
          {submitLabel}
        </Button>
      )}
    </form>
  )
}
