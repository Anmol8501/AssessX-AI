import { useCallback } from 'react'
import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { ErrorState, LoadingState } from '@/components/ui'
import { ExamFinished } from '@/features/exam/ExamFinished'
import { Centred, ExamRunner } from '@/features/exam/ExamRunner'
import { useAttempt, useExamDetail } from '@/features/exam/useExam'
import type { AttemptDetail } from '@/features/exam/types'
import { TERMINAL_ATTEMPT_STATUSES } from '@/features/exam/types'
import { ProctoredExam } from '@/features/proctoring/ProctoredExam'

/**
 * The exam itself, outside the application shell: no sidebar, no navigation, nothing to read but
 * the question. This is the screen a candidate spends the whole exam on.
 *
 * The attempt is resolved from the assessment rather than passed in the URL, so reopening the app
 * on this route resumes the same attempt instead of starting another — and resolves to the
 * finished screen once it is over, rather than reopening a closed exam.
 *
 * Every way into an exam arrives here, so this is also where a proctored exam is gated (Phase 4A):
 * a proctored attempt — or a proctored exam not yet started — goes through the proctoring check
 * in `ProctoredExam` before the paper is shown. Whether an attempt is proctored is the attempt's
 * own answer (`attempt.proctoring`), fixed when it started.
 */
export function ExamAttemptPage() {
  const { assessmentId = '' } = useParams()
  const navigate = useNavigate()
  const { state: examState, reload: reloadExam } = useExamDetail(assessmentId)
  // The latest attempt, not only an active one: after submitting or running out of time there is
  // nothing to resume, but there is still something to show.
  const attemptId = examState.status === 'ready' ? examState.data.latest_attempt_id : null
  const { state: attemptState, reload, replace } = useAttempt(attemptId)

  // A proctored exam starts its attempt from the check screen. The new attempt is shown at once,
  // and the exam details are re-read so `latest_attempt_id` (and reloads) point at it.
  const handleStarted = useCallback(
    (attempt: AttemptDetail) => {
      replace(attempt)
      void reloadExam()
    },
    [replace, reloadExam],
  )
  const handleStale = useCallback(() => {
    void reloadExam()
    void reload()
  }, [reloadExam, reload])

  if (examState.status === 'loading') {
    return (
      <Centred>
        <LoadingState title="Opening your exam…" layout="page" />
      </Centred>
    )
  }

  if (examState.status === 'error') {
    return (
      <Centred>
        <ErrorState title="Could not open this exam" description={examState.message} />
      </Centred>
    )
  }

  const exam = examState.data

  if (attemptId && attemptState.status !== 'ready') {
    return (
      <Centred>
        {attemptState.status === 'error' ? (
          <ErrorState title="Could not load your exam" description={attemptState.message} />
        ) : (
          <LoadingState title="Opening your exam…" layout="page" />
        )}
      </Centred>
    )
  }

  const attempt = attemptState.status === 'ready' ? attemptState.data : null

  if (attempt && TERMINAL_ATTEMPT_STATUSES.has(attempt.status)) {
    return <ExamFinished attempt={attempt} />
  }

  const proctored = attempt ? attempt.proctoring !== null : exam.proctoring_required

  if (proctored && (attempt || exam.can_start)) {
    return (
      <ProctoredExam
        key={assessmentId}
        exam={exam}
        attempt={attempt}
        onAttempt={handleStarted}
        onFinished={replace}
        onStale={handleStale}
      />
    )
  }

  if (!attempt) {
    return (
      <Centred>
        <ErrorState
          title="This exam has not been started"
          description={exam.start_blocked_reason ?? 'Open the exam details to begin.'}
          onRetry={() => navigate(routes.candidate.examDetail(assessmentId))}
        />
      </Centred>
    )
  }

  return <ExamRunner attempt={attempt} onFinished={replace} onStale={() => void reload()} />
}
