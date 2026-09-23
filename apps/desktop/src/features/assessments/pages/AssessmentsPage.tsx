import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { routes } from '@/app/routes'
import { AssessmentsIcon, ClockIcon } from '@/components/icons'
import {
  Button,
  ButtonLink,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui'
import { STATUS_LABEL, type AssessmentSummary } from '../types'
import { describeError, useAssessmentActions, useAssessmentList } from '../useAssessments'

/** Admin assessment list. Publishing and assignment are Phase 2B/2C. */
export function AssessmentsPage() {
  const navigate = useNavigate()
  const { state, reload } = useAssessmentList()
  const { deleteAssessment } = useAssessmentActions()
  const [pendingDelete, setPendingDelete] = useState<AssessmentSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteAssessment(pendingDelete.id)
      setPendingDelete(null)
      await reload()
    } catch (error) {
      setDeleteError(describeError(error, 'Could not delete the assessment.'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Assessments"
        description="Create exams and manage their questions."
        actions={<ButtonLink to={routes.admin.assessmentNew}>+ Create Assessment</ButtonLink>}
      />

      {state.status === 'loading' && (
        <Card>
          <LoadingState title="Loading assessments…" />
        </Card>
      )}

      {state.status === 'error' && (
        <Card>
          <ErrorState title="Could not load assessments" description={state.message} onRetry={() => void reload()} />
        </Card>
      )}

      {state.status === 'ready' &&
        (state.data.length === 0 ? (
          <Card>
            <EmptyState
              title="No assessments yet"
              description="Create your first exam to start adding questions."
              action={<Button onClick={() => navigate(routes.admin.assessmentNew)}>+ Create Assessment</Button>}
            />
          </Card>
        ) : (
          <ul className="space-y-3">
            {state.data.map((assessment) => (
              <li key={assessment.id}>
                <Card className="hover:border-line-strong px-5 py-4 transition-colors">
                  <div className="flex items-start justify-between gap-6">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <Link
                          to={routes.admin.assessmentDetail(assessment.id)}
                          className="text-ink hover:text-accent truncate text-[15px] font-semibold"
                        >
                          {assessment.title}
                        </Link>
                        <StatusBadge tone={assessment.status === 'PUBLISHED' ? 'accent' : assessment.status === 'READY' ? 'ok' : 'neutral'}>{STATUS_LABEL[assessment.status]}</StatusBadge>
                      </div>
                      {assessment.description && (
                        <p className="text-ink-muted mt-1 line-clamp-1 text-[13px]">{assessment.description}</p>
                      )}
                      <p className="text-ink-subtle mt-2 flex items-center gap-3 text-[12.5px]">
                        <span className="inline-flex items-center gap-1.5">
                          <AssessmentsIcon className="text-[14px]" />
                          {assessment.question_count} {assessment.question_count === 1 ? 'question' : 'questions'}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <ClockIcon className="text-[14px]" />
                          {assessment.duration_minutes} min
                        </span>
                        <span>{assessment.total_marks} marks</span>
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <ButtonLink to={routes.admin.assessmentDetail(assessment.id)} variant="secondary" size="sm">
                        Open
                      </ButtonLink>
                      <Button variant="ghost" size="sm" onClick={() => setPendingDelete(assessment)}>
                        Delete
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        ))}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete assessment?"
        description={
          pendingDelete
            ? `This permanently deletes "${pendingDelete.title}" and its ${pendingDelete.question_count} question(s).`
            : undefined
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          setPendingDelete(null)
          setDeleteError(null)
        }}
      >
        {deleteError && (
          <p className="text-danger mt-3 text-[13px]" role="alert">
            {deleteError}
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
