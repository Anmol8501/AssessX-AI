import { useState } from 'react'
import { AlertIcon, CheckIcon, InfoIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, ConfirmDialog, InfoList, StatusBadge } from '@/components/ui'
import { NAVIGATION_LABEL, STATUS_LABEL, QUESTION_TYPE_LABEL, type AssessmentDetail } from '../types'
import { stepForField, type BuilderStep } from './steps'

function formatDate(value: string | null): string {
  if (!value) return 'Not set'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not set' : date.toLocaleString()
}

interface ReviewSectionProps {
  assessment: AssessmentDetail
  busy: boolean
  error: string | null
  onMarkReady(): void
  onRevertToDraft(): void
  onPublish(): void
  onUnpublish(): void
  onGoToStep(step: BuilderStep): void
}

/** Summary of the whole assessment plus every reason it cannot be marked ready. */
export function ReviewSection({
  assessment,
  busy,
  error,
  onMarkReady,
  onRevertToDraft,
  onPublish,
  onUnpublish,
  onGoToStep,
}: ReviewSectionProps) {
  const { readiness, settings } = assessment
  const isReady = assessment.status === 'READY'
  const isPublished = assessment.status === 'PUBLISHED'
  const [confirmingPublish, setConfirmingPublish] = useState(false)

  return (
    <div className="space-y-4">
      {error && (
        <div className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]" role="alert">
          <AlertIcon className="mt-0.5 shrink-0 text-[15px]" />
          {error}
        </div>
      )}

      <Card>
        <CardHeader
          title={readiness.is_ready ? 'Ready to mark' : 'Not ready yet'}
          description={
            readiness.is_ready
              ? 'Everything checks out. Marking it ready freezes nothing — you can return to draft at any time.'
              : 'Fix the following before this assessment can be marked ready.'
          }
          actions={<StatusBadge tone={isReady ? 'ok' : 'neutral'}>{STATUS_LABEL[assessment.status]}</StatusBadge>}
        />
        <CardBody>
          {readiness.is_ready ? (
            <p className="text-ok flex items-center gap-2 text-[13.5px]">
              <CheckIcon className="text-[16px]" />
              All checks passed.
            </p>
          ) : (
            <ul className="space-y-2" aria-label="Readiness issues">
              {readiness.issues.map((issue, index) => (
                <li key={`${issue.field}-${index}`} className="flex items-start justify-between gap-3 text-[13.5px]">
                  <span className="text-ink-muted flex items-start gap-2">
                    <AlertIcon className="text-warn mt-0.5 shrink-0 text-[15px]" />
                    {issue.message}
                  </span>
                  <button
                    type="button"
                    onClick={() => onGoToStep(stepForField(issue.field))}
                    className="text-accent hover:text-accent-hover shrink-0 text-[12.5px] font-medium"
                  >
                    Fix
                  </button>
                </li>
              ))}
            </ul>
          )}

          {isPublished && (
            <p className="text-ink-muted mt-4 flex items-start gap-2 text-[13px]">
              <InfoIcon className="mt-0.5 shrink-0 text-[15px]" />
              Published assessments are read-only: questions, settings and marks are locked so the candidates
              holding it always see the same exam. Unpublish to edit again — possible only while nobody is
              assigned.
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            {isPublished ? (
              <Button variant="secondary" loading={busy} onClick={onUnpublish}>
                Unpublish
              </Button>
            ) : isReady ? (
              <>
                <Button variant="secondary" loading={busy} onClick={onRevertToDraft}>
                  Return to draft
                </Button>
                <Button loading={busy} onClick={() => setConfirmingPublish(true)}>
                  Publish assessment
                </Button>
              </>
            ) : (
              <Button loading={busy} disabled={!readiness.is_ready} onClick={onMarkReady}>
                Mark as Ready
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Assessment" />
          <CardBody>
            <InfoList
              items={[
                { label: 'Title', value: assessment.title },
                { label: 'Description', value: assessment.description || '—' },
                { label: 'Duration', value: `${assessment.duration_minutes} minutes` },
                { label: 'Total marks', value: String(assessment.total_marks) },
                { label: 'Passing marks', value: String(assessment.passing_marks) },
                { label: 'Allocated marks', value: `${assessment.allocated_marks} across ${assessment.question_count} question(s)` },
                { label: 'Status', value: STATUS_LABEL[assessment.status] },
              ]}
            />
            {assessment.instructions && (
              <div className="border-line bg-surface mt-4 rounded-md border px-3 py-2.5">
                <p className="text-ink-subtle text-[11.5px] font-semibold tracking-[0.1em] uppercase">Instructions</p>
                <p className="text-ink-muted mt-1 text-[13px] leading-relaxed whitespace-pre-line">{assessment.instructions}</p>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Settings" />
          <CardBody>
            <InfoList
              items={[
                { label: 'Maximum attempts', value: String(settings.max_attempts) },
                { label: 'Question navigation', value: NAVIGATION_LABEL[settings.question_navigation] },
                { label: 'Randomise questions', value: settings.randomize_questions ? 'Yes' : 'No' },
                { label: 'Randomise options', value: settings.randomize_options ? 'Yes' : 'No' },
                { label: 'Show results after submission', value: settings.show_results ? 'Yes' : 'No' },
                { label: 'Available from', value: formatDate(settings.availability_start) },
                { label: 'Available until', value: formatDate(settings.availability_end) },
              ]}
            />
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmingPublish}
        title="Publish assessment?"
        confirmLabel="Publish assessment"
        busy={busy}
        onConfirm={() => {
          setConfirmingPublish(false)
          onPublish()
        }}
        onCancel={() => setConfirmingPublish(false)}
      >
        <div className="text-ink-muted mt-3 space-y-1 text-[13px]">
          <p className="text-ink font-medium">{assessment.title}</p>
          <p>
            {assessment.question_count} question(s) · {assessment.total_marks} marks · {assessment.duration_minutes}{' '}
            minutes
          </p>
          {(settings.availability_start || settings.availability_end) && (
            <p>
              Available {formatDate(settings.availability_start)} – {formatDate(settings.availability_end)}
            </p>
          )}
          <p className="pt-2">
            Publishing makes it available for assignment and locks its questions, settings and marks. You can
            unpublish while no candidate is assigned.
          </p>
        </div>
      </ConfirmDialog>

      <Card>
        <CardHeader title="Questions" description="In the order a candidate will see them." />
        {assessment.questions.length === 0 ? (
          <CardBody>
            <p className="text-ink-subtle text-[13.5px]">No questions yet.</p>
          </CardBody>
        ) : (
          <ul className="divide-line divide-y">
            {assessment.questions.map((question, index) => (
              <li key={question.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <p className="text-ink min-w-0 text-[13.5px]">
                  <span className="text-ink-subtle mr-2 font-mono text-[12.5px]">{index + 1}.</span>
                  {question.text}
                </p>
                <span className="text-ink-subtle shrink-0 text-[12.5px]">
                  {QUESTION_TYPE_LABEL[question.type]} · {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
