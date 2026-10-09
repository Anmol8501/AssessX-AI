import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Button, ConfirmDialog, LoadingState } from '@/components/ui'
import { cn } from '@/lib/cn'
import { ProblemStatement } from '../admin/parts'
import { hiddenVerdictLabel, VERDICT_LABEL, type Execution, type SubmissionRow } from '../types'
import { CodeEditor } from './CodeEditor'
import { useCodingQuestion, type SaveState } from './useCodingQuestion'

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'All changes saved',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  offline: 'Offline — your code is kept on this computer and will be saved when the connection returns',
  conflict: 'Changed in another window',
}

const VERDICT_TONE: Record<string, string> = {
  ACCEPTED: 'text-ok',
  COMPLETED: 'text-ink',
  WRONG_ANSWER: 'text-danger',
  COMPILATION_ERROR: 'text-danger',
  RUNTIME_ERROR: 'text-danger',
  TIME_LIMIT_EXCEEDED: 'text-warn',
  MEMORY_LIMIT_EXCEEDED: 'text-warn',
  OUTPUT_LIMIT_EXCEEDED: 'text-warn',
  SYSTEM_ERROR: 'text-ink-muted',
}

type ConsoleTab = 'results' | 'input' | 'submissions'

/**
 * The candidate's coding workspace (stage C3), inside the exam screen: the problem on the left, the editor
 * and its console on the right, with a draggable divider. Ctrl+Enter runs, Ctrl+Shift+Enter submits.
 * Runs use the sample tests (or the candidate's own input when the assessment allows it); a submission
 * runs every test, and hidden ones are reported only as a count.
 */
export const CODING_OPENED_EVENT = 'assessx:coding-question-opened'

export function CodingWorkspace({
  attemptId,
  questionId,
  number,
  onProgress,
}: {
  attemptId: string
  questionId: string
  /** The question's number in the exam (for the factual "opened" event and paste events). */
  number: number
  onProgress?: () => void
}) {
  const coding = useCodingQuestion(attemptId, questionId, onProgress)
  // A fact for the proctoring timeline (recorded by the proctored exam when there is one).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(CODING_OPENED_EVENT, { detail: { questionNumber: number } }))
  }, [questionId, number])
  const [split, setSplit] = useState(42)
  const [dark, setDark] = useState(false)
  const [fontSize, setFontSize] = useState(14)
  const [tab, setTab] = useState<ConsoleTab>('results')
  const [customInput, setCustomInput] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(false)

  if (coding.loadError) return <p className="text-danger p-6 text-[13px]" role="alert">{coding.loadError}</p>
  const question = coding.question
  if (!question) return <LoadingState title="Opening the problem…" />

  const problem = question.problem
  const left = question.max_submissions - coding.submissions.length
  const running = coding.busy || (coding.execution !== null && !['COMPLETED', 'FAILED'].includes(coding.execution.status))

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget.parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    const move = (e: PointerEvent) => setSplit(Math.min(70, Math.max(20, ((e.clientX - rect.left) / rect.width) * 100)))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const shortcuts = (event: ReactKeyboardEvent) => {
    if (!event.ctrlKey || event.key !== 'Enter' || running) return
    event.preventDefault()
    if (event.shiftKey) setConfirmSubmit(true)
    else {
      setTab('results')
      void coding.run()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={shortcuts} data-testid="coding-workspace" data-question-number={number}>
      <div className="flex min-h-0 flex-1">
        {split > 0 && (
          <section className="bg-card border-line min-w-0 overflow-y-auto rounded-lg border px-7 py-6" style={{ width: `${split}%` }} aria-label="Problem">
            <p className="text-ink-subtle mb-3 text-[12px]">
              {question.marks} marks · {left} of {question.max_submissions} submissions left
            </p>
            <ProblemStatement problem={problem} />
          </section>
        )}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize problem and editor"
          aria-valuenow={Math.round(split)}
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplit((s) => Math.max(20, s - 5))
            if (e.key === 'ArrowRight') setSplit((s) => Math.min(70, s + 5))
          }}
          className="group flex w-3 shrink-0 cursor-col-resize items-center justify-center focus:outline-none"
        >
          <span aria-hidden className="bg-line group-hover:bg-accent group-focus-visible:bg-accent h-12 w-1 rounded-full" />
        </div>
        <section className="bg-card border-line flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border" aria-label="Code">
          <div className="border-line flex min-h-12 items-center gap-3 border-b px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <label className="sr-only" htmlFor={`lang-${questionId}`}>
                Language
              </label>
              <select
                id={`lang-${questionId}`}
                className="border-line-strong bg-card h-8 rounded-md border px-2 text-[13px]"
                value={coding.language}
                onChange={(e) => coding.switchLanguage(e.target.value)}
                disabled={running}
              >
                {problem.languages.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.version})
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1" role="group" aria-label="Font size">
                <Button size="sm" variant="ghost" onClick={() => setFontSize((s) => Math.max(11, s - 1))} aria-label="Smaller text">
                  A−
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setFontSize((s) => Math.min(22, s + 1))} aria-label="Larger text">
                  A+
                </Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDark((d) => !d)}>
                {dark ? 'Light theme' : 'Dark theme'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSplit((s) => (s > 0 ? 0 : 42))}>
                {split > 0 ? 'Wide editor' : 'Show problem'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)} disabled={running}>
                Reset code
              </Button>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {coding.saveState === 'conflict' && (
                <Button size="sm" variant="secondary" onClick={() => void coding.reloadFromServer()}>
                  Load newest
                </Button>
              )}
              <Button size="sm" variant="secondary" disabled={running} onClick={() => { setTab('results'); void coding.run() }}>
                {running && coding.execution?.kind !== 'SUBMIT' ? 'Running…' : 'Run'}
              </Button>
              <Button size="sm" disabled={running || left <= 0} onClick={() => setConfirmSubmit(true)}>
                Submit
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <CodeEditor value={coding.code} language={coding.language} dark={dark} fontSize={fontSize} onChange={(v) => coding.edit(v)} label={`Code editor, ${coding.language}`} />
          </div>
          <Console
            tab={tab}
            onTab={setTab}
            execution={coding.execution}
            error={coding.requestError}
            submissions={coding.submissions}
            allowCustomInput={question.allow_custom_input}
            customInput={customInput}
            onCustomInput={setCustomInput}
            onRunCustom={() => { setTab('results'); void coding.run(customInput) }}
            running={running}
            saveStatus={
              <span title={SAVE_LABEL[coding.saveState]} className={cn('min-w-0 truncate text-[12px]', coding.saveState === 'saved' ? 'text-ink-subtle' : coding.saveState === 'conflict' || coding.saveState === 'offline' ? 'text-warn' : 'text-ink-muted')} role="status" aria-label="Save status">
                {SAVE_LABEL[coding.saveState]}
              </span>
            }
          />
        </section>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset your code?"
        description="Your code for this problem is replaced with the starter code. This can't be undone."
        confirmLabel="Reset"
        confirmVariant="danger"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          coding.reset()
          setConfirmReset(false)
        }}
      />
      <ConfirmDialog
        open={confirmSubmit}
        title="Submit your code?"
        description={`Your code runs against every test, including hidden ones. You have ${left} submission${left === 1 ? '' : 's'} left for this problem; your best submission counts.`}
        confirmLabel="Submit"
        onCancel={() => setConfirmSubmit(false)}
        onConfirm={() => {
          setConfirmSubmit(false)
          setTab('results')
          void coding.submit()
        }}
      />
    </div>
  )
}

function Console({
  tab,
  onTab,
  execution,
  error,
  submissions,
  allowCustomInput,
  customInput,
  onCustomInput,
  onRunCustom,
  running,
  saveStatus,
}: {
  tab: ConsoleTab
  onTab(tab: ConsoleTab): void
  execution: Execution | null
  error: string | null
  submissions: SubmissionRow[]
  allowCustomInput: boolean
  customInput: string
  onCustomInput(v: string): void
  onRunCustom(): void
  running: boolean
  /** The editor's save state, shown at the right of the console's tab bar. */
  saveStatus: ReactNode
}) {
  const tabs: [ConsoleTab, string][] = [['results', 'Results'], ...(allowCustomInput ? [['input', 'Your input'] as [ConsoleTab, string]] : []), ['submissions', `Submissions (${submissions.length})`]]
  return (
    <div className="border-line flex h-60 shrink-0 flex-col border-t">
      <div className="border-line flex items-center gap-4 border-b px-2">
        <div className="flex shrink-0" role="tablist" aria-label="Console">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => onTab(key)} className={cn('-mb-px px-3 py-2.5 text-[12.5px] font-medium', tab === key ? 'border-accent text-ink border-b-2' : 'text-ink-muted hover:text-ink')}>
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex min-w-0 pr-3">{saveStatus}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[12.5px]">
        {tab === 'results' && <Results execution={execution} error={error} />}
        {tab === 'input' && (
          <div className="space-y-2">
            <label className="text-ink-muted block" htmlFor="custom-input">
              Input (stdin) for a run with your own data
            </label>
            <textarea id="custom-input" rows={4} maxLength={65536} value={customInput} onChange={(e) => onCustomInput(e.target.value)} className="border-line-strong bg-card w-full rounded-md border px-2 py-1.5 font-mono text-[12.5px]" />
            <Button size="sm" variant="secondary" disabled={running} onClick={onRunCustom}>
              Run with this input
            </Button>
          </div>
        )}
        {tab === 'submissions' && (
          <table className="w-full text-left" aria-label="Your submissions">
            <thead className="text-ink-subtle">
              <tr>
                <th className="py-1 font-medium">#</th>
                <th className="py-1 font-medium">Language</th>
                <th className="py-1 font-medium">Result</th>
                <th className="py-1 font-medium">Tests</th>
                <th className="py-1 font-medium">Time</th>
                <th className="py-1 font-medium">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="border-line border-t">
                  <td className="py-1">{s.number}</td>
                  <td className="py-1">{s.language}</td>
                  <td className={cn('py-1 font-medium', VERDICT_TONE[s.verdict ?? ''] ?? 'text-ink-muted')}>{s.verdict ? VERDICT_LABEL[s.verdict] ?? s.verdict : 'Checking…'}</td>
                  <td className="py-1 tabular-nums">{s.total != null ? `${s.passed}/${s.total}` : '—'}</td>
                  <td className="py-1 tabular-nums">{s.runtime_ms != null ? `${s.runtime_ms} ms` : '—'}</td>
                  <td className="py-1">{new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                </tr>
              ))}
              {submissions.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-ink-subtle py-2">
                    No submissions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Results({ execution, error }: { execution: Execution | null; error: string | null }) {
  if (error) return <p className="text-danger" role="alert">{error}</p>
  if (!execution) return <p className="text-ink-subtle">Run your code to check it against the sample tests. Submit to check it against every test.</p>
  if (execution.status === 'QUEUED' || execution.status === 'RUNNING') {
    return <p className="text-ink-muted" role="status">{execution.status === 'QUEUED' ? 'Queued…' : 'Running tests…'}</p>
  }
  const verdict = execution.verdict ?? ''
  return (
    <div className="space-y-3" aria-label="Execution result">
      <p className={cn('text-[13.5px] font-semibold', VERDICT_TONE[verdict])} role="status">
        {execution.kind === 'SUBMIT' ? 'Submission: ' : 'Run: '}
        {VERDICT_LABEL[verdict] ?? verdict}
        {execution.total != null && execution.verdict !== 'COMPILATION_ERROR' ? ` · ${execution.passed}/${execution.total} tests passed` : ''}
        {execution.runtime_ms != null ? ` · ${execution.runtime_ms} ms` : ''}
        {execution.memory_kb != null ? ` · ${(execution.memory_kb / 1024).toFixed(1)} MB` : ''}
      </p>
      {execution.compile_output && <pre className="bg-surface overflow-x-auto rounded px-2 py-1.5 font-mono whitespace-pre-wrap" aria-label="Compiler output">{execution.compile_output}</pre>}
      {execution.tests.map((t) => (
        <div key={`${t.visibility}-${t.number}`} className="border-line rounded-md border p-3">
          <p className={cn('font-medium', VERDICT_TONE[t.verdict])}>
            {t.visibility === 'CUSTOM' ? 'Your input' : `Sample ${t.number}`}: {VERDICT_LABEL[t.verdict] ?? t.verdict}
            {t.runtime_ms != null ? ` · ${t.runtime_ms} ms` : ''}
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Pre label="Input" value={t.input} />
            {t.expected_output !== null && <Pre label="Expected output" value={t.expected_output} />}
            <Pre label="Your output" value={t.stdout} />
          </div>
          {t.stderr && <Pre label="Errors" value={t.stderr} />}
        </div>
      ))}
      {execution.hidden_total != null && execution.hidden_total > 0 && (
        <div className="border-line rounded-md border p-3">
          <p className="text-ink-muted">
            Hidden tests: {execution.hidden_passed} of {execution.hidden_total} passed. Their inputs and outputs are not shown.
          </p>
          {execution.hidden_results.length > 0 && (
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2" aria-label="Hidden test results">
              {execution.hidden_results.map((h) => (
                <li key={h.number} className="flex items-center justify-between gap-2 rounded bg-surface px-2 py-1">
                  <span className="text-ink">Hidden test {h.number}</span>
                  <span className={cn('font-medium', VERDICT_TONE[h.verdict])}>{hiddenVerdictLabel(h.verdict)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Pre({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-ink-subtle mb-1 text-[11px] font-medium uppercase">{label}</p>
      <pre className="bg-surface max-h-28 overflow-auto rounded px-2.5 py-1.5 font-mono whitespace-pre-wrap">{value || ' '}</pre>
    </div>
  )
}
