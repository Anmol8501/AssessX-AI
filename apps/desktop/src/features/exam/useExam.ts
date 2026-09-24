import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi } from '@/features/session'
import { ApiError } from '@/lib/api'
import type { AnswerState, AttemptAnswer, AttemptDetail, ExamDetail, SaveState } from './types'

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

const ME = '/api/v1/candidates/me'

/** The exam details screen: what the exam is, and whether the server will let it be started. */
export function useExamDetail(assessmentId: string) {
  const api = useApi()
  const [state, setState] = useState<Loadable<ExamDetail>>({ status: 'loading' })

  const load = useCallback(
    (signal?: AbortSignal) =>
      api<ExamDetail>(`${ME}/assessments/${assessmentId}`, { signal })
        .then((data) => {
          if (!signal?.aborted) setState({ status: 'ready', data })
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) {
            setState({ status: 'error', message: describeError(error, 'Could not load this exam.') })
          }
        }),
    [api, assessmentId],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { state, reload: load }
}

/**
 * Starts the exam, or resumes the attempt already under way.
 *
 * The endpoint is idempotent, so a double-click or a retried request cannot produce a second
 * attempt — the guard is the server's, not a disabled button's.
 */
export function useStartExam() {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(
    async (assessmentId: string): Promise<AttemptDetail | null> => {
      setBusy(true)
      setError(null)
      try {
        return await api<AttemptDetail>(`${ME}/assessments/${assessmentId}/attempts`, { method: 'POST' })
      } catch (caught) {
        setError(describeError(caught, 'Could not start this exam.'))
        return null
      } finally {
        setBusy(false)
      }
    },
    [api],
  )

  return { start, busy, error }
}

/**
 * Submits the attempt.
 *
 * Failure is never swallowed: `attempt_locked` means the server finished the attempt first (the
 * clock ran out), and the caller reloads to show the finished state rather than leaving the
 * candidate on a screen that no longer reflects reality.
 */
export function useSubmitExam() {
  const api = useApi()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(
    async (attemptId: string): Promise<AttemptDetail | null> => {
      setBusy(true)
      setError(null)
      try {
        return await api<AttemptDetail>(`${ME}/attempts/${attemptId}/submit`, { method: 'POST' })
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'attempt_locked') {
          setError(null) // not a failure to report: the exam simply ended first
          return null
        }
        setError(describeError(caught, 'Could not submit this exam.'))
        return null
      } finally {
        setBusy(false)
      }
    },
    [api],
  )

  return { submit, busy, error }
}

/** The attempt and its paper. Loading this is how a refresh restores the exam. */
export function useAttempt(attemptId: string | null) {
  const api = useApi()
  const [state, setState] = useState<Loadable<AttemptDetail>>({ status: 'loading' })

  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!attemptId) return Promise.resolve()
      return api<AttemptDetail>(`${ME}/attempts/${attemptId}`, { signal })
        .then((data) => {
          if (!signal?.aborted) setState({ status: 'ready', data })
        })
        .catch((error: unknown) => {
          if (!signal?.aborted) {
            setState({ status: 'error', message: describeError(error, 'Could not load your exam.') })
          }
        })
    },
    [api, attemptId],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  /** Replaces the loaded attempt with one the caller already has (e.g. the submit response). */
  const replace = useCallback((data: AttemptDetail) => setState({ status: 'ready', data }), [])

  return { state, reload: load, replace }
}

/**
 * Holds the candidate's answers and keeps the server in step with them.
 *
 * The rules that matter here:
 *
 * * **The screen updates immediately, the server catches up.** Waiting for a round trip before
 *   showing a selection makes the exam feel broken on a slow link.
 * * **A failed save is never reported as saved.** The per-question state goes to `error`, the
 *   candidate's choice stays on screen, and they are told it is not confirmed — losing an answer
 *   silently is the worst thing this screen could do.
 * * **One request per question at a time.** Writes to the same question are queued behind the one
 *   in flight and collapsed to the latest value, so rapid clicking cannot land out of order.
 *
 * There is no offline buffering: an attempt is server state, and a candidate must not be able to
 * keep working past the deadline just because their connection dropped.
 *
 * `onLocked` fires when the server refuses a write because the attempt has been finished — the
 * clock ran out while the candidate was still typing. The exam screen uses it to show the finished
 * state rather than leaving them answering an exam that has already closed.
 */
export function useAnswers(attemptId: string, initial: AttemptAnswer[], onLocked?: () => void) {
  const api = useApi()
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() => fromWire(initial))
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({})

  const pending = useRef<Record<string, string[] | undefined>>({})
  const inFlight = useRef<Record<string, boolean>>({})
  const mounted = useRef(true)
  // Held in a ref so changing the callback does not tear down the in-flight queue.
  const onLockedRef = useRef(onLocked)
  useEffect(() => {
    onLockedRef.current = onLocked
  }, [onLocked])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const flush = useCallback(
    async (questionId: string): Promise<void> => {
      if (inFlight.current[questionId]) return // whatever is queued is drained by the loop below
      inFlight.current[questionId] = true
      const base = `${ME}/attempts/${attemptId}/answers/${questionId}`
      try {
        // Drains anything queued while a request was in flight, so clicking quickly collapses to
        // the latest value instead of racing several requests against each other.
        while (pending.current[questionId] !== undefined) {
          const selected = pending.current[questionId] as string[]
          pending.current[questionId] = undefined
          setSaveStates((s) => ({ ...s, [questionId]: 'saving' }))
          try {
            await api<AttemptAnswer>(base, { method: 'PUT', body: { selected_option_ids: selected } })
            if (mounted.current) setSaveStates((s) => ({ ...s, [questionId]: 'saved' }))
          } catch (caught) {
            if (caught instanceof ApiError && caught.code === 'attempt_locked') {
              // Not a save failure: the exam ended. Retrying would be pointless and misleading.
              pending.current[questionId] = undefined
              if (mounted.current) setSaveStates((s) => ({ ...s, [questionId]: 'idle' }))
              onLockedRef.current?.()
              break
            }
            // The local answer is deliberately left alone: it is what the candidate chose, and it
            // is shown as unconfirmed rather than thrown away. `retry` re-sends what is on screen.
            if (mounted.current) setSaveStates((s) => ({ ...s, [questionId]: 'error' }))
            break
          }
        }
      } finally {
        inFlight.current[questionId] = false
      }
    },
    [api, attemptId],
  )

  const setSelection = useCallback(
    (questionId: string, selected: string[]) => {
      setAnswers((current) => ({ ...current, [questionId]: selected }))
      pending.current[questionId] = selected
      void flush(questionId)
    },
    [flush],
  )

  /** Re-sends what is on screen after a failure. */
  const retry = useCallback(
    (questionId: string) => {
      setAnswers((current) => {
        pending.current[questionId] = current[questionId] ?? []
        return current
      })
      void flush(questionId)
    },
    [flush],
  )

  return { answers, saveStates, setSelection, retry }
}

function fromWire(answers: AttemptAnswer[]): Record<string, AnswerState> {
  return Object.fromEntries(answers.map((answer) => [answer.question_id, answer.selected_option_ids]))
}
