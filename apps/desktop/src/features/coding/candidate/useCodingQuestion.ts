import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi } from '@/features/session'
import { ApiError } from '@/lib/api'
import type { CandidateCodingQuestion, Draft, Execution, SubmissionRow } from '../types'
import { initialCode, isFinished, newRequestKey, readLocalDraft, writeLocalDraft } from './codingLogic'

const SAVE_DELAY_MS = 1500
const POLL_MS = 1000

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'offline' | 'conflict'

/**
 * One coding question of the candidate's attempt (stage C3): the problem, the code, autosave, Run, Submit,
 * results and history. The server stays authoritative for everything — the code it stores, the verdicts,
 * the limits and the clock.
 *
 * * **Autosave** is debounced (never per keystroke). Every edit is also kept in local storage at once, so
 *   a dropped connection or a closed window loses nothing; the next save sends it. A save that the server
 *   refuses because another window saved newer code ("conflict") never overwrites it.
 * * **Run / Submit** carry a fresh idempotency key, kept while the request is retried, so a double click
 *   or a retry after a network error never creates two jobs; the result is polled until it finishes.
 */
export function useCodingQuestion(attemptId: string, questionId: string, onProgress?: () => void) {
  const api = useApi()
  const base = `/api/v1/candidates/me/attempts/${attemptId}/coding/${questionId}`
  const [question, setQuestion] = useState<CandidateCodingQuestion | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState('python')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [execution, setExecution] = useState<Execution | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([])

  const revision = useRef(0)
  const pending = useRef<{ language: string; source: string } | null>(null)
  const timer = useRef<number | null>(null)
  const saving = useRef(false)
  const progressed = useRef(onProgress)
  useEffect(() => {
    progressed.current = onProgress
  })

  // -- loading ------------------------------------------------------------------------------------------
  useEffect(() => {
    let active = true
    api<CandidateCodingQuestion>(base).then(
      (data) => {
        if (!active) return
        const languages = data.problem.languages.map((l) => l.id)
        const start = initialCode(data.draft, readLocalDraft(attemptId, questionId), data.problem.starter_code, languages)
        revision.current = start.revision
        setQuestion(data)
        setLanguage(start.language)
        setCode(start.source)
        setSaveState(start.unsaved ? 'unsaved' : 'saved')
        if (start.unsaved) pending.current = { language: start.language, source: start.source }
      },
      (error: unknown) => active && setLoadError(describeError(error, 'Could not open this problem.')),
    )
    api<SubmissionRow[]>(`${base}/submissions`).then((rows) => active && setSubmissions(rows), () => undefined)
    return () => {
      active = false
    }
  }, [api, base, attemptId, questionId])

  // -- autosave -----------------------------------------------------------------------------------------
  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const next = pending.current
    if (!next || saving.current) return
    saving.current = true
    pending.current = null
    setSaveState('saving')
    try {
      const saved = await api<Draft>(`${base}/draft`, {
        method: 'PUT',
        body: { language: next.language, source: next.source, base_revision: revision.current },
      })
      revision.current = saved.revision
      writeLocalDraft(attemptId, questionId, { ...next, revision: saved.revision, savedAt: Date.now() })
      setSaveState(pending.current ? 'unsaved' : 'saved')
      if (saved.revision === 1) progressed.current?.() // the first draft: "in progress" on the navigator
    } catch (error) {
      if (error instanceof ApiError && error.code === 'draft_conflict') {
        setSaveState('conflict')
      } else if (error instanceof ApiError && (error.code === 'attempt_locked' || error.code === 'attempt_on_hold')) {
        setSaveState('unsaved') // the exam screen shows the lock or the end; the text stays local
      } else {
        pending.current = pending.current ?? next // keep it; the next edit or retry sends it
        setSaveState('offline')
      }
    } finally {
      saving.current = false
    }
  }, [api, base, attemptId, questionId])

  const edit = useCallback(
    (source: string, lang = language) => {
      setCode(source)
      pending.current = { language: lang, source }
      writeLocalDraft(attemptId, questionId, { language: lang, source, revision: revision.current, savedAt: Date.now() })
      setSaveState((s) => (s === 'conflict' ? s : 'unsaved'))
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [attemptId, questionId, flush, language],
  )

  // Retry an offline save every few seconds; save on leaving the question or the window.
  useEffect(() => {
    if (saveState !== 'offline') return
    const retry = window.setInterval(() => void flush(), 5000)
    return () => window.clearInterval(retry)
  }, [saveState, flush])
  useEffect(() => {
    const onHide = () => void flush()
    window.addEventListener('blur', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('blur', onHide)
      document.removeEventListener('visibilitychange', onHide)
      void flush()
    }
  }, [flush])

  /** After a conflict: take the newest server copy (this window's text stays in the local backup). */
  const reloadFromServer = useCallback(async () => {
    const data = await api<CandidateCodingQuestion>(base)
    if (data.draft) {
      revision.current = data.draft.revision
      setLanguage(data.draft.language)
      setCode(data.draft.source)
    }
    pending.current = null
    setSaveState('saved')
  }, [api, base])

  const switchLanguage = useCallback(
    (next: string) => {
      if (!question) return
      setLanguage(next)
      // Starter code for an empty editor or untouched starter; otherwise keep the candidate's text.
      const starters = question.problem.starter_code
      const untouched = !code.trim() || Object.values(starters).includes(code)
      edit(untouched ? (starters[next] ?? '') : code, next)
    },
    [question, code, edit],
  )

  const reset = useCallback(() => {
    if (question) edit(question.problem.starter_code[language] ?? '', language)
  }, [question, language, edit])

  // -- run / submit -------------------------------------------------------------------------------------
  const pendingRequest = useRef<{ kind: 'runs' | 'submissions'; key: string; body: object } | null>(null)

  const poll = useCallback(
    async (id: string) => {
      for (;;) {
        const current = await api<Execution>(`${base}/executions/${id}`)
        setExecution(current)
        if (isFinished(current.status)) return current
        await new Promise((resolve) => window.setTimeout(resolve, POLL_MS))
      }
    },
    [api, base],
  )

  const request = useCallback(
    async (kind: 'runs' | 'submissions', customInput?: string) => {
      setRequestError(null)
      setBusy(true)
      await flush()
      // The same key for a retry of the same request: the server returns the original instead of a copy.
      const body = { language, source: code, ...(customInput !== undefined ? { custom_input: customInput } : {}) }
      const same = pendingRequest.current && pendingRequest.current.kind === kind && JSON.stringify(pendingRequest.current.body) === JSON.stringify(body)
      const key = same ? pendingRequest.current!.key : newRequestKey()
      pendingRequest.current = { kind, key, body }
      try {
        const queued = await api<Execution>(`${base}/${kind}`, { method: 'POST', body: { ...body, idempotency_key: key } })
        pendingRequest.current = null
        setExecution(queued)
        const done = await poll(queued.id)
        if (kind === 'submissions') {
          setSubmissions(await api<SubmissionRow[]>(`${base}/submissions`))
          progressed.current?.()
        }
        return done
      } catch (error) {
        setRequestError(describeError(error, kind === 'runs' ? 'Could not run your code.' : 'Could not submit your code.'))
        if (error instanceof ApiError && error.status && error.status < 500) pendingRequest.current = null
        return null
      } finally {
        setBusy(false)
      }
    },
    [api, base, code, language, flush, poll],
  )

  return {
    question,
    loadError,
    code,
    language,
    saveState,
    execution,
    requestError,
    busy,
    submissions,
    edit,
    switchLanguage,
    reset,
    reloadFromServer,
    run: (customInput?: string) => request('runs', customInput),
    submit: () => request('submissions'),
  }
}
