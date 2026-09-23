import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { routes } from '@/app/routes'
import { AlertIcon, ArrowLeftIcon } from '@/components/icons'
import { Button, Card, CardBody, Field, Input, PageHeader } from '@/components/ui'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { describeError, useAssessmentActions } from '../useAssessments'

interface Errors {
  title?: string
  duration_minutes?: string
  total_marks?: string
  passing_marks?: string
}

const EMPTY = { title: '', description: '', instructions: '', duration: '60', total: '50', passing: '20' }

function positiveInt(value: string): number | null {
  const parsed = Number(value)
  return value.trim() && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function CreateAssessmentPage() {
  const navigate = useNavigate()
  const { createAssessment } = useAssessmentActions()
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = (key: keyof typeof EMPTY) => (value: string) => setValues((v) => ({ ...v, [key]: value }))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setFormError(null)

    const duration = positiveInt(values.duration)
    const total = positiveInt(values.total)
    const passing = values.passing.trim() && Number.isInteger(Number(values.passing)) && Number(values.passing) >= 0 ? Number(values.passing) : null

    const next: Errors = {}
    if (values.title.trim().length < 3) next.title = 'Enter a title of at least 3 characters.'
    if (duration === null) next.duration_minutes = 'Enter a duration in whole minutes.'
    if (total === null) next.total_marks = 'Enter the total marks.'
    if (passing === null) next.passing_marks = 'Enter the passing marks.'
    else if (total !== null && passing > total) next.passing_marks = 'Passing marks cannot exceed total marks.'
    setErrors(next)
    if (Object.keys(next).length > 0) return

    setSubmitting(true)
    try {
      const created = await createAssessment({
        title: values.title.trim(),
        description: values.description.trim() || null,
        instructions: values.instructions.trim() || null,
        duration_minutes: duration!,
        total_marks: total!,
        passing_marks: passing!,
      })
      navigate(routes.admin.assessmentDetail(created.id), { replace: true })
    } catch (error) {
      // Surface the server's field-level messages when it disagrees with the client.
      if (error instanceof ApiError && error.code === 'validation_error' && Array.isArray(error.details)) {
        const details = error.details as Array<{ field?: string; message?: string }>
        const mapped: Errors = {}
        for (const detail of details) {
          const key = detail.field?.split('.').pop() as keyof Errors | undefined
          if (key && key in ({ title: 1, duration_minutes: 1, total_marks: 1, passing_marks: 1 } as const)) {
            mapped[key] = detail.message
          }
        }
        setErrors(mapped)
      }
      setFormError(describeError(error, 'Could not create the assessment.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Create Assessment"
        description="Set up the exam. You can add questions once it is created."
        actions={
          <Button variant="ghost" leadingIcon={<ArrowLeftIcon className="text-[16px]" />} onClick={() => navigate(routes.admin.assessments)}>
            Back
          </Button>
        }
      />

      <Card className="max-w-2xl">
        <CardBody>
          <form onSubmit={handleSubmit} noValidate className="space-y-4" aria-label="Create assessment">
            {formError && (
              <div className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
                <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
                {formError}
              </div>
            )}

            <Field label="Title" error={errors.title}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  autoFocus
                  placeholder="Data Structures Mid-Term"
                  value={values.title}
                  onChange={(e) => set('title')(e.target.value)}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  disabled={submitting}
                />
              )}
            </Field>

            <Field label="Description" hint="Optional. Shown in the assessment list.">
              {({ id }) => (
                <Input
                  id={id}
                  placeholder="Mid-term examination covering Modules 1–3"
                  value={values.description}
                  onChange={(e) => set('description')(e.target.value)}
                  disabled={submitting}
                />
              )}
            </Field>

            <Field label="Instructions" hint="Optional. Shown to candidates before the exam starts.">
              {({ id }) => (
                <textarea
                  id={id}
                  rows={3}
                  placeholder="Answer all questions carefully…"
                  value={values.instructions}
                  onChange={(e) => set('instructions')(e.target.value)}
                  disabled={submitting}
                  className={cn(
                    'border-line-strong bg-card text-ink placeholder:text-ink-subtle/80 hover:border-ink-subtle focus:border-accent focus:ring-accent-ring w-full rounded-md border px-3 py-2 text-[14px] transition-colors focus:ring-2 focus:outline-none',
                  )}
                />
              )}
            </Field>

            <div className="grid grid-cols-3 gap-4">
              <Field label="Duration (minutes)" error={errors.duration_minutes}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    value={values.duration}
                    onChange={(e) => set('duration')(e.target.value)}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    disabled={submitting}
                  />
                )}
              </Field>

              <Field label="Total marks" error={errors.total_marks}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    type="number"
                    min={1}
                    value={values.total}
                    onChange={(e) => set('total')(e.target.value)}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    disabled={submitting}
                  />
                )}
              </Field>

              <Field label="Passing marks" error={errors.passing_marks}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    value={values.passing}
                    onChange={(e) => set('passing')(e.target.value)}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    disabled={submitting}
                  />
                )}
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => navigate(routes.admin.assessments)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Create Assessment
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  )
}
