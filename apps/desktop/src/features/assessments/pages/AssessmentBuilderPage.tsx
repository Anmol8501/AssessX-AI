import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { ArrowLeftIcon } from '@/components/icons'
import { Button, Card, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import { AssignmentsSection } from '../builder/AssignmentsSection'
import { BasicInfoSection } from '../builder/BasicInfoSection'
import { BuilderSteps } from '../builder/BuilderSteps'
import { BUILDER_STEPS, stepForField, type BuilderStep } from '../builder/steps'
import { QuestionsSection } from '../builder/QuestionsSection'
import { ReviewSection } from '../builder/ReviewSection'
import { SettingsSection } from '../builder/SettingsSection'
import { STATUS_LABEL, type AssessmentPatch, type QuestionInput } from '../types'
import { describeError, useAssessment, useAssessmentActions } from '../useAssessments'

/**
 * The assessment builder: basic information, questions, settings and review in one place.
 * Each section saves explicitly, so moving between steps never loses saved work.
 */
export function AssessmentBuilderPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>()
  const navigate = useNavigate()
  const { state, reload } = useAssessment(assessmentId)
  const actions = useAssessmentActions()

  const [step, setStep] = useState<BuilderStep>('basics')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedStep, setSavedStep] = useState<BuilderStep | null>(null)
  const [busyQuestionId, setBusyQuestionId] = useState<string | null>(null)

  /** Runs a write, refreshes the assessment, and reports failure as a message rather than a throw. */
  const run = useCallback(
    async (action: () => Promise<unknown>, fallback: string, successStep?: BuilderStep) => {
      setSaving(true)
      setError(null)
      try {
        await action()
        await reload()
        if (successStep) {
          setSavedStep(successStep)
          setTimeout(() => setSavedStep(null), 2500)
        }
        return true
      } catch (err) {
        setError(describeError(err, fallback))
        return false
      } finally {
        setSaving(false)
      }
    },
    [reload],
  )

  const incompleteSteps = useMemo(() => {
    if (state.status !== 'ready') return new Set<BuilderStep>()
    return new Set(state.data.readiness.issues.map((issue) => stepForField(issue.field)))
  }, [state])

  if (state.status === 'loading') {
    return (
      <Card>
        <LoadingState title="Loading assessment…" />
      </Card>
    )
  }
  if (state.status === 'error') {
    return (
      <Card>
        <ErrorState title="Could not load the assessment" description={state.message} onRetry={() => void reload()} />
      </Card>
    )
  }

  const assessment = state.data
  const id = assessment.id
  // Published assessments are read-only; the backend refuses these writes too.
  const locked = assessment.status === 'PUBLISHED'

  const savePatch = (patch: AssessmentPatch, from: BuilderStep) =>
    void run(() => actions.updateAssessment(id, patch), 'Could not save your changes.', from)

  return (
    <>
      <PageHeader
        title={assessment.title}
        description={`${assessment.question_count} question(s) · ${assessment.allocated_marks} of ${assessment.total_marks} marks · ${assessment.duration_minutes} min · ${assessment.assignment_count} assigned`}
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge tone={assessment.status === 'PUBLISHED' ? 'accent' : assessment.status === 'READY' ? 'ok' : 'neutral'} dot>
              {STATUS_LABEL[assessment.status]}
            </StatusBadge>
            <Button variant="ghost" leadingIcon={<ArrowLeftIcon className="text-[16px]" />} onClick={() => navigate(routes.admin.assessments)}>
              All assessments
            </Button>
          </div>
        }
      />

      <BuilderSteps
          current={step}
          onSelect={setStep}
          incomplete={incompleteSteps}
          hints={{
            assign: locked
              ? `${assessment.assignment_count} assigned`
              : 'Publish first',
          }}
        />

      <div className="mt-6">
        {step === 'basics' && (
          <BasicInfoSection
            key={assessment.updated_at}
            assessment={assessment}
            saving={saving}
            error={error}
            saved={savedStep === 'basics'}
            locked={locked}
            onSave={(patch) => savePatch(patch, 'basics')}
          />
        )}

        {step === 'questions' && (
          <QuestionsSection
            assessment={assessment}
            locked={locked}
            saving={saving}
            error={error}
            busyQuestionId={busyQuestionId}
            onDismissError={() => setError(null)}
            onCreate={(input: QuestionInput) => run(() => actions.createQuestion(id, input), 'Could not add the question.')}
            onUpdate={(questionId, input) => run(() => actions.updateQuestion(id, questionId, input), 'Could not save the question.')}
            onDelete={async (questionId) => {
              setBusyQuestionId(questionId)
              await run(() => actions.deleteQuestion(id, questionId), 'Could not delete the question.')
              setBusyQuestionId(null)
            }}
            onDuplicate={async (questionId) => {
              setBusyQuestionId(questionId)
              await run(() => actions.duplicateQuestion(id, questionId), 'Could not duplicate the question.')
              setBusyQuestionId(null)
            }}
            onReorder={async (questionIds) => {
              await run(() => actions.reorderQuestions(id, questionIds), 'Could not reorder the questions.')
            }}
          />
        )}

        {step === 'settings' && (
          <SettingsSection
            key={assessment.updated_at}
            assessment={assessment}
            saving={saving}
            error={error}
            saved={savedStep === 'settings'}
            locked={locked}
            onSave={(patch) => savePatch(patch, 'settings')}
          />
        )}

        {step === 'review' && (
          <ReviewSection
            assessment={assessment}
            busy={saving}
            error={error}
            onGoToStep={setStep}
            onMarkReady={() => void run(() => actions.markReady(id), 'Could not mark the assessment ready.')}
            onRevertToDraft={() => void run(() => actions.revertToDraft(id), 'Could not return the assessment to draft.')}
            onPublish={() => void run(() => actions.publish(id), 'Could not publish the assessment.')}
            onUnpublish={() => void run(() => actions.unpublish(id), 'Could not unpublish the assessment.')}
          />
        )}

        {step === 'assign' && <AssignmentsSection assessment={assessment} onChanged={() => void reload()} />}
      </div>

      {/* Simple linear progression for admins who prefer to walk the steps. */}
      <div className="mt-6 flex justify-between">
        <Button
          variant="secondary"
          disabled={step === BUILDER_STEPS[0]}
          onClick={() => setStep(BUILDER_STEPS[BUILDER_STEPS.indexOf(step) - 1] ?? 'basics')}
        >
          Back
        </Button>
        <Button
          variant="secondary"
          disabled={step === BUILDER_STEPS[BUILDER_STEPS.length - 1]}
          onClick={() => setStep(BUILDER_STEPS[BUILDER_STEPS.indexOf(step) + 1] ?? 'review')}
        >
          Next
        </Button>
      </div>
    </>
  )
}
