import { useState, type FormEvent } from 'react'
import { AlertIcon, CheckIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { LockedNotice } from './LockedNotice'
import type { AssessmentDetail, AssessmentPatch } from '../types'

interface Errors {
  title?: string
  duration_minutes?: string
  total_marks?: string
  passing_marks?: string
}

interface BasicInfoSectionProps {
  /** Published assessments are locked; the form is shown but cannot be saved. */
  locked?: boolean
  assessment: AssessmentDetail
  saving: boolean
  error: string | null
  saved: boolean
  onSave(patch: AssessmentPatch): void
}

export function BasicInfoSection({ assessment, saving, error, saved, locked = false, onSave }: BasicInfoSectionProps) {
  const [title, setTitle] = useState(assessment.title)
  const [description, setDescription] = useState(assessment.description ?? '')
  const [instructions, setInstructions] = useState(assessment.instructions ?? '')
  const [duration, setDuration] = useState(String(assessment.duration_minutes))
  const [total, setTotal] = useState(String(assessment.total_marks))
  const [passing, setPassing] = useState(String(assessment.passing_marks))
  const [errors, setErrors] = useState<Errors>({})

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const durationValue = Number(duration)
    const totalValue = Number(total)
    const passingValue = Number(passing)

    const next: Errors = {}
    if (title.trim().length < 3) next.title = 'Enter a title of at least 3 characters.'
    if (!Number.isInteger(durationValue) || durationValue < 1) next.duration_minutes = 'Duration must be a whole number of minutes.'
    if (!Number.isInteger(totalValue) || totalValue < 1) next.total_marks = 'Total marks must be at least 1.'
    if (!Number.isInteger(passingValue) || passingValue < 0) next.passing_marks = 'Passing marks cannot be negative.'
    else if (Number.isInteger(totalValue) && passingValue > totalValue) next.passing_marks = 'Passing marks cannot exceed total marks.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    onSave({
      title: title.trim(),
      description: description.trim() || null,
      instructions: instructions.trim() || null,
      duration_minutes: durationValue,
      total_marks: totalValue,
      passing_marks: passingValue,
    })
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader title="Basic information" description="What the assessment is and how it is marked." />
      <CardBody>
        <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Basic information">
          {locked && <LockedNotice />}
          {error && (
            <div className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
              <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
              {error}
            </div>
          )}

          <Field label="Title" error={errors.title}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-describedby={describedBy}
                invalid={invalid}
                disabled={saving}
              />
            )}
          </Field>

          <Field label="Description" hint="Optional. Shown in the assessment list.">
            {({ id }) => (
              <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} />
            )}
          </Field>

          <Field label="Instructions" hint="Optional. Shown to candidates before the exam starts.">
            {({ id }) => (
              <textarea
                id={id}
                rows={3}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={saving}
                className="border-line-strong bg-card text-ink placeholder:text-ink-subtle/80 hover:border-ink-subtle focus:border-accent focus:ring-accent-ring w-full rounded-md border px-3 py-2 text-[14px] transition-colors focus:ring-2 focus:outline-none"
              />
            )}
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Duration (minutes)" error={errors.duration_minutes}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="number" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} aria-describedby={describedBy} invalid={invalid} disabled={saving} />
              )}
            </Field>
            <Field label="Total marks" error={errors.total_marks}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} aria-describedby={describedBy} invalid={invalid} disabled={saving} />
              )}
            </Field>
            <Field label="Passing marks" error={errors.passing_marks}>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="number" min={0} value={passing} onChange={(e) => setPassing(e.target.value)} aria-describedby={describedBy} invalid={invalid} disabled={saving} />
              )}
            </Field>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <span className={cn('text-ok flex items-center gap-1.5 text-[13px] transition-opacity', saved ? 'opacity-100' : 'opacity-0')} role="status">
              <CheckIcon className="text-[15px]" />
              Saved
            </span>
            <Button type="submit" loading={saving} disabled={locked}>
              Save basic information
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  )
}
