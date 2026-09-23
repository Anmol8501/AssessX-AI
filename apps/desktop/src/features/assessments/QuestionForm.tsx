import { useState, type FormEvent } from 'react'
import { AlertIcon, CheckIcon } from '@/components/icons'
import { Button, Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  MAX_OPTIONS,
  MIN_OPTIONS,
  QUESTION_TYPE_LABEL,
  SINGLE_ANSWER_TYPES,
  TRUE_FALSE_OPTIONS,
  type Question,
  type QuestionInput,
  type QuestionOptionInput,
  type QuestionType,
} from './types'

const TYPES: QuestionType[] = ['MCQ', 'MULTIPLE_SELECT', 'TRUE_FALSE']

const trueFalseOptions = (): QuestionOptionInput[] =>
  TRUE_FALSE_OPTIONS.map((text, index) => ({ text, is_correct: index === 0 }))

const blankChoices = (): QuestionOptionInput[] => [
  { text: '', is_correct: true },
  { text: '', is_correct: false },
  { text: '', is_correct: false },
  { text: '', is_correct: false },
]

interface Errors {
  text?: string
  marks?: string
  options?: string
}

/** Mirrors the backend rules so the admin sees problems before submitting; the server re-checks. */
function validate(type: QuestionType, text: string, marks: string, options: QuestionOptionInput[]): Errors {
  const errors: Errors = {}
  if (!text.trim()) errors.text = 'Enter the question.'
  const marksValue = Number(marks)
  if (!marks.trim() || !Number.isInteger(marksValue) || marksValue < 1) errors.marks = 'Marks must be a whole number of at least 1.'

  if (type !== 'TRUE_FALSE') {
    const filled = options.filter((option) => option.text.trim())
    if (filled.length < MIN_OPTIONS) errors.options = `Provide at least ${MIN_OPTIONS} options.`
    else {
      const seen = new Set(filled.map((option) => option.text.trim().toLowerCase()))
      if (seen.size !== filled.length) errors.options = 'Options must be distinct.'
    }
  }
  if (!errors.options) {
    const correct = options.filter((option) => option.is_correct && (type === 'TRUE_FALSE' || option.text.trim()))
    if (SINGLE_ANSWER_TYPES.has(type) && correct.length !== 1) errors.options = 'Select exactly one correct answer.'
    if (!SINGLE_ANSWER_TYPES.has(type) && correct.length === 0) errors.options = 'Select at least one correct answer.'
  }
  return errors
}

interface QuestionFormProps {
  /** Supplied when editing; omitted when adding. */
  question?: Question
  submitting: boolean
  error: string | null
  onSubmit(input: QuestionInput): void
  onCancel(): void
}

export function QuestionForm({ question, submitting, error, onSubmit, onCancel }: QuestionFormProps) {
  const [type, setType] = useState<QuestionType>(question?.type ?? 'MCQ')
  const [text, setText] = useState(question?.text ?? '')
  const [marks, setMarks] = useState(String(question?.marks ?? 1))
  const [explanation, setExplanation] = useState(question?.explanation ?? '')
  const [options, setOptions] = useState<QuestionOptionInput[]>(
    question
      ? question.options.map((option) => ({ text: option.text, is_correct: option.is_correct }))
      : blankChoices(),
  )
  const [errors, setErrors] = useState<Errors>({})

  function changeType(next: QuestionType) {
    setType(next)
    setErrors({})
    // True/false has a fixed answer set; switching back restores editable choices.
    if (next === 'TRUE_FALSE') setOptions(trueFalseOptions())
    else if (type === 'TRUE_FALSE') setOptions(blankChoices())
  }

  function setOption(index: number, patch: Partial<QuestionOptionInput>) {
    setOptions((current) =>
      current.map((option, i) => {
        if (i !== index) {
          // Single-answer types: selecting one clears the others.
          return patch.is_correct && SINGLE_ANSWER_TYPES.has(type) ? { ...option, is_correct: false } : option
        }
        return { ...option, ...patch }
      }),
    )
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const nextErrors = validate(type, text, marks, options)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    onSubmit({
      type,
      text: text.trim(),
      marks: Number(marks),
      explanation: explanation.trim() || null,
      options: options
        .filter((option) => option.text.trim())
        .map((option) => ({ text: option.text.trim(), is_correct: option.is_correct })),
    })
  }

  const isTrueFalse = type === 'TRUE_FALSE'
  const single = SINGLE_ANSWER_TYPES.has(type)

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label={question ? 'Edit question' : 'Add question'}>
      {error && (
        <div className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
          <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-[1fr_120px] gap-4">
        <Field label="Question type">
          {({ id }) => (
            <select
              id={id}
              value={type}
              onChange={(e) => changeType(e.target.value as QuestionType)}
              disabled={submitting}
              className="border-line-strong bg-card text-ink hover:border-ink-subtle focus:border-accent focus:ring-accent-ring h-10 w-full rounded-md border px-3 text-[14px] transition-colors focus:ring-2 focus:outline-none"
            >
              {TYPES.map((value) => (
                <option key={value} value={value}>
                  {QUESTION_TYPE_LABEL[value]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Marks" error={errors.marks}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="number"
              min={1}
              value={marks}
              onChange={(e) => setMarks(e.target.value)}
              aria-describedby={describedBy}
              invalid={invalid}
              disabled={submitting}
            />
          )}
        </Field>
      </div>

      <Field label="Question" error={errors.text}>
        {({ id, describedBy, invalid }) => (
          <textarea
            id={id}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What is the time complexity of binary search?"
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            disabled={submitting}
            className={cn(
              'text-ink placeholder:text-ink-subtle/80 w-full rounded-md border px-3 py-2 text-[14px] transition-colors focus:ring-2 focus:outline-none',
              invalid
                ? 'border-danger focus:border-danger focus:ring-red-100'
                : 'border-line-strong bg-card hover:border-ink-subtle focus:border-accent focus:ring-accent-ring',
            )}
          />
        )}
      </Field>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-ink text-[13px] font-medium">
            Options <span className="text-ink-subtle font-normal">· {single ? 'select one correct answer' : 'select all correct answers'}</span>
          </span>
          {!isTrueFalse && options.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={() => setOptions((current) => [...current, { text: '', is_correct: false }])}
              className="text-accent hover:text-accent-hover text-[12.5px] font-medium"
              disabled={submitting}
            >
              + Add option
            </button>
          )}
        </div>

        <ul className="space-y-2">
          {options.map((option, index) => (
            <li key={index} className="flex items-center gap-2">
              <button
                type="button"
                role={single ? 'radio' : 'checkbox'}
                aria-checked={option.is_correct}
                aria-label={`Mark option ${index + 1} correct`}
                onClick={() => setOption(index, { is_correct: single ? true : !option.is_correct })}
                disabled={submitting}
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center border transition-colors',
                  single ? 'rounded-full' : 'rounded-md',
                  option.is_correct ? 'border-ok bg-ok text-white' : 'border-line-strong bg-card text-transparent hover:border-ink-subtle',
                )}
              >
                <CheckIcon className="text-[16px]" />
              </button>

              {isTrueFalse ? (
                <span className="border-line bg-surface text-ink flex h-10 flex-1 items-center rounded-md border px-3 text-[14px]">
                  {option.text}
                </span>
              ) : (
                <Input
                  value={option.text}
                  onChange={(e) => setOption(index, { text: e.target.value })}
                  placeholder={`Option ${String.fromCharCode(65 + index)}`}
                  aria-label={`Option ${index + 1}`}
                  disabled={submitting}
                />
              )}

              {!isTrueFalse && options.length > MIN_OPTIONS && (
                <button
                  type="button"
                  onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                  disabled={submitting}
                  className="text-ink-subtle hover:text-danger shrink-0 px-1 text-[13px]"
                  aria-label={`Remove option ${index + 1}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {errors.options && (
          <p className="text-danger text-[12.5px]" role="alert">
            {errors.options}
          </p>
        )}
      </div>

      <Field label="Explanation" hint="Optional. Shown to reviewers, never to a candidate during an exam.">
        {({ id }) => (
          <Input id={id} value={explanation} onChange={(e) => setExplanation(e.target.value)} disabled={submitting} />
        )}
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {question ? 'Save changes' : 'Save question'}
        </Button>
      </div>
    </form>
  )
}
