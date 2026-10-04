import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { routes } from '@/app/routes'
import { AlertIcon, ArrowLeftIcon, CheckIcon } from '@/components/icons'
import { Button, Card, CardBody, CardHeader, Checkbox, ConfirmDialog, ErrorState, Field, Input, LoadingState, PageHeader, StatusBadge, Textarea } from '@/components/ui'
import { cn } from '@/lib/cn'
import { DIFFICULTY_LABEL, parseTags, SUGGESTED_TAGS, VERDICT_LABEL, type AdminExecution, type CodingProblemForCandidate, type Difficulty, type Example, type Language, type Version, type VersionPatch, type Visibility } from '../types'
import { describeError, useCodingActions, useLanguages, useProblem } from '../useCoding'
import { MONO_AREA, ProblemStatement, SELECT } from './parts'

/**
 * One coding problem (stage C1): its versions, and the builder for the open draft.
 *
 * A draft is edited section by section and saved as a whole ("Save draft"); test cases save one by one.
 * Publishing is refused by the server until the draft is complete; once published a version never
 * changes, and "New version" starts the next draft as a copy. Hidden tests and the reference solution are
 * admin-only; "Preview" renders exactly what a candidate receives.
 */
export function CodingProblemPage() {
  const { problemId = '' } = useParams()
  const navigate = useNavigate()
  const { state, reload } = useProblem(problemId)
  const languages = useLanguages()
  const actions = useCodingActions()
  const [selected, setSelected] = useState<string | null>(null)
  const [version, setVersion] = useState<Version | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null)

  const problem = state.status === 'ready' ? state.data : null
  const defaultVersion = problem ? (problem.draft ?? problem.latest ?? problem.versions[problem.versions.length - 1])?.id ?? null : null
  const versionId = selected ?? defaultVersion

  const loadVersion = useCallback(
    () =>
      versionId
        ? actions.version(problemId, versionId).then(setVersion, (err: unknown) => setError(describeError(err, 'Could not load the version.')))
        : Promise.resolve(),
    [actions, problemId, versionId],
  )

  useEffect(() => {
    void loadVersion()
  }, [loadVersion])

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      await reload()
      await loadVersion()
      return true
    } catch (err) {
      setError(describeError(err, fallback))
      return false
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <Button variant="ghost" onClick={() => navigate(routes.admin.codingProblems)} leadingIcon={<ArrowLeftIcon />}>
      All problems
    </Button>
  )
  if (state.status === 'loading') {
    return (
      <>
        <PageHeader title="Coding problem" actions={back} />
        <Card>
          <LoadingState title="Loading the problem…" />
        </Card>
      </>
    )
  }
  if (state.status === 'error' || !problem) {
    return (
      <>
        <PageHeader title="Coding problem" actions={back} />
        <Card>
          <ErrorState title="Could not load the problem" description={state.status === 'error' ? state.message : ''} onRetry={() => void reload()} />
        </Card>
      </>
    )
  }

  const draft = version?.status === 'DRAFT'
  const langs = languages.state.status === 'ready' ? languages.state.data.languages : []

  return (
    <>
      <PageHeader
        title={version?.title ?? problem.slug}
        description={`${problem.slug} · used in ${problem.used_in} assessment question(s)`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!problem.is_enabled && <StatusBadge tone="warn">Disabled</StatusBadge>}
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => actions.setEnabled(problem.id, !problem.is_enabled), 'Could not change the problem.')}>
              {problem.is_enabled ? 'Disable' : 'Enable'}
            </Button>
            {problem.used_in === 0 && (
              <Button variant="ghost" size="sm" onClick={() => setConfirm('delete')}>
                Delete
              </Button>
            )}
            {back}
          </div>
        }
      />

      {error && (
        <p className="bg-danger-soft text-danger mb-4 flex items-start gap-2 rounded-md px-3 py-2 text-[13px]" role="alert">
          <AlertIcon className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-2" aria-label="Versions">
          <span className="text-ink-muted text-[13px]">Versions:</span>
          {problem.versions.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelected(v.id)}
              aria-pressed={v.id === versionId}
              className={cn('rounded-md border px-2.5 py-1 text-[12.5px]', v.id === versionId ? 'border-accent bg-accent-soft/40 text-ink' : 'border-line text-ink-muted hover:border-line-strong')}
            >
              v{v.version} · {v.status === 'PUBLISHED' ? 'Published' : 'Draft'}
            </button>
          ))}
          <span className="flex-1" />
          {!problem.draft && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(async () => setSelected((await actions.newVersion(problem.id)).id), 'Could not start a new version.')}>
              New version
            </Button>
          )}
          {draft && problem.versions.length > 1 && (
            <Button size="sm" variant="ghost" onClick={() => setConfirm('discard')}>
              Discard draft
            </Button>
          )}
        </CardBody>
      </Card>

      {!version ? (
        <Card>
          <LoadingState title="Loading the version…" />
        </Card>
      ) : (
        <VersionEditor
          key={`${version.id}:${version.updated_at}`}
          version={version}
          languages={langs}
          editable={draft}
          busy={busy}
          onSave={(patch) => run(() => actions.updateVersion(problem.id, version.id, patch), 'Could not save the draft.')}
          onPublish={() => run(() => actions.publish(problem.id, version.id), 'Could not publish.')}
          onAddTest={(input) => run(() => actions.addTest(problem.id, version.id, input), 'Could not add the test case.')}
          onUpdateTest={(testId, patch) => run(() => actions.updateTest(problem.id, version.id, testId, patch), 'Could not save the test case.')}
          onDeleteTest={(testId) => run(() => actions.deleteTest(problem.id, version.id, testId), 'Could not delete the test case.')}
          loadPreview={() => actions.preview(problem.id, version.id)}
          validate={() => actions.validate(problem.id, version.id)}
          validation={() => actions.validation(problem.id, version.id)}
          onValidated={() => void reload().then(loadVersion)}
        />
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'delete' ? 'Delete this problem?' : 'Discard this draft?'}
        description={confirm === 'delete' ? 'Every version and test case is deleted. This cannot be undone.' : 'The draft and its changes are thrown away. Published versions stay.'}
        confirmLabel={confirm === 'delete' ? 'Delete' : 'Discard'}
        confirmVariant="danger"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          void (async () => {
            if (confirm === 'delete') {
              if (await run(() => actions.remove(problem.id), 'Could not delete the problem.')) navigate(routes.admin.codingProblems)
            } else if (version) {
              await run(async () => {
                await actions.discardDraft(problem.id, version.id)
                setSelected(null)
              }, 'Could not discard the draft.')
            }
            setConfirm(null)
          })()
        }
      />
    </>
  )
}

interface EditorProps {
  version: Version
  languages: Language[]
  editable: boolean
  busy: boolean
  onSave(patch: VersionPatch): Promise<boolean>
  onPublish(): Promise<boolean>
  onAddTest(input: { visibility: Visibility; input: string; expected_output: string; weight: number }): Promise<boolean>
  onUpdateTest(testId: string, patch: { visibility?: Visibility; input?: string; expected_output?: string; weight?: number }): Promise<boolean>
  onDeleteTest(testId: string): Promise<boolean>
  loadPreview(): Promise<CodingProblemForCandidate>
  validate(): Promise<AdminExecution>
  validation(): Promise<AdminExecution>
  /** A validation finished: reload the version (its `validated_at` and publishing issues). */
  onValidated(): void
}

function VersionEditor({ version, languages, editable, busy, onSave, onPublish, onAddTest, onUpdateTest, onDeleteTest, loadPreview, validate, validation, onValidated }: EditorProps) {
  const [draft, setDraft] = useState<VersionPatch>(() => ({
    title: version.title,
    difficulty: version.difficulty,
    tags: version.tags,
    statement: version.statement,
    constraints: version.constraints ?? '',
    input_format: version.input_format ?? '',
    output_format: version.output_format ?? '',
    examples: version.examples,
    languages: version.languages,
    starter_code: version.starter_code,
    time_limit_ms: version.time_limit_ms,
    memory_limit_mb: version.memory_limit_mb,
    default_points: version.default_points,
    partial_scoring: version.partial_scoring,
    reference_language: version.reference_language,
    reference_solution: version.reference_solution ?? '',
  }))
  const [tagsText, setTagsText] = useState(version.tags.join(', '))
  const [starterLang, setStarterLang] = useState(version.languages[0] ?? 'python')
  const [preview, setPreview] = useState<CodingProblemForCandidate | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const set = <K extends keyof VersionPatch>(key: K, value: VersionPatch[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
  }
  const examples = draft.examples ?? []
  const enabled = draft.languages ?? []

  const save = () =>
    onSave({
      ...draft,
      tags: parseTags(tagsText),
      constraints: draft.constraints || null,
      input_format: draft.input_format || null,
      output_format: draft.output_format || null,
      reference_language: draft.reference_solution?.trim() ? draft.reference_language ?? null : null,
      reference_solution: draft.reference_solution?.trim() ? draft.reference_solution : null,
    }).then((ok) => {
      if (ok) setDirty(false)
      return ok
    })

  const toggleLanguage = (id: string, on: boolean) => {
    const next = on ? [...enabled, id] : enabled.filter((l) => l !== id)
    set('languages', languages.map((l) => l.id).filter((l) => next.includes(l)))
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        {editable ? (
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-ink-muted text-[13px]">
                Draft v{version.version} — {dirty ? <span className="text-warn">unsaved changes</span> : 'all changes saved'}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => void save()} loading={busy} disabled={!dirty}>
                  Save draft
                </Button>
                <Button onClick={() => void onPublish()} disabled={busy || dirty || version.issues.length > 0}>
                  Publish v{version.version}
                </Button>
              </div>
            </CardBody>
          </Card>
        ) : (
          <p className="text-ink-muted flex items-center gap-2 text-[13px]">
            <CheckIcon className="text-ok" /> Published v{version.version} — published versions never change. Use “New version” to edit.
          </p>
        )}

        <Card>
          <CardHeader title="Basic information" />
          <CardBody className="space-y-3">
            <Field label="Title">{({ id }) => <Input id={id} value={draft.title ?? ''} maxLength={200} disabled={!editable} onChange={(e) => set('title', e.target.value)} />}</Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Difficulty">
                {({ id }) => (
                  <select id={id} className={SELECT} value={draft.difficulty} disabled={!editable} onChange={(e) => set('difficulty', e.target.value as Difficulty)}>
                    {Object.entries(DIFFICULTY_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Tags" hint={`Comma-separated. Suggestions: ${SUGGESTED_TAGS.slice(0, 6).join(', ')}…`}>
                {({ id, describedBy }) => (
                  <Input id={id} aria-describedby={describedBy} value={tagsText} disabled={!editable} onChange={(e) => { setTagsText(e.target.value); setDirty(true) }} />
                )}
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Problem statement" />
          <CardBody className="space-y-3">
            <Field label="Statement">{({ id }) => <Textarea id={id} rows={8} value={draft.statement ?? ''} disabled={!editable} onChange={(e) => set('statement', e.target.value)} />}</Field>
            <Field label="Input format">{({ id }) => <Textarea id={id} rows={2} value={draft.input_format ?? ''} disabled={!editable} onChange={(e) => set('input_format', e.target.value)} />}</Field>
            <Field label="Output format">{({ id }) => <Textarea id={id} rows={2} value={draft.output_format ?? ''} disabled={!editable} onChange={(e) => set('output_format', e.target.value)} />}</Field>
            <Field label="Constraints" hint="e.g. 1 <= n <= 100000">
              {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} className="font-mono" value={draft.constraints ?? ''} disabled={!editable} onChange={(e) => set('constraints', e.target.value)} />}
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Examples"
            description="Worked examples shown with the statement."
            actions={editable && examples.length < 10 ? <Button size="sm" variant="secondary" onClick={() => set('examples', [...examples, { input: '', output: '', explanation: '' }])}>+ Add example</Button> : undefined}
          />
          <CardBody className="space-y-4">
            {examples.length === 0 && <p className="text-ink-subtle text-[13px]">No examples yet.</p>}
            {examples.map((example, i) => {
              const update = (patch: Partial<Example>) => set('examples', examples.map((e, j) => (j === i ? { ...e, ...patch } : e)))
              return (
                <div key={i} className="border-line space-y-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-ink text-[13px] font-medium">Example {i + 1}</p>
                    {editable && <Button size="sm" variant="ghost" onClick={() => set('examples', examples.filter((_, j) => j !== i))}>Remove</Button>}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Input">{({ id }) => <textarea id={id} rows={3} className={MONO_AREA} value={example.input} disabled={!editable} onChange={(e) => update({ input: e.target.value })} />}</Field>
                    <Field label="Output">{({ id }) => <textarea id={id} rows={3} className={MONO_AREA} value={example.output} disabled={!editable} onChange={(e) => update({ output: e.target.value })} />}</Field>
                  </div>
                  <Field label="Explanation">{({ id }) => <Input id={id} value={example.explanation ?? ''} disabled={!editable} onChange={(e) => update({ explanation: e.target.value })} />}</Field>
                </div>
              )
            })}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Languages and starter code" description="Candidates can only choose the languages enabled here." />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-4" role="group" aria-label="Supported languages">
              {languages.map((lang) => (
                <Checkbox key={lang.id} label={`${lang.name} (${lang.version})`} checked={enabled.includes(lang.id)} disabled={!editable} onChange={(e) => toggleLanguage(lang.id, e.target.checked)} />
              ))}
            </div>
            {enabled.length > 0 && (
              <>
                <div className="flex gap-1" role="tablist" aria-label="Starter code language">
                  {enabled.map((id) => (
                    <button key={id} type="button" role="tab" aria-selected={starterLang === id} onClick={() => setStarterLang(id)} className={cn('rounded-md px-2.5 py-1 text-[12.5px]', starterLang === id ? 'bg-accent text-white' : 'text-ink-muted hover:bg-gray-100')}>
                      {languages.find((l) => l.id === id)?.name ?? id}
                    </button>
                  ))}
                </div>
                <textarea
                  aria-label={`Starter code (${starterLang})`}
                  rows={9}
                  spellCheck={false}
                  className={MONO_AREA}
                  value={draft.starter_code?.[starterLang] ?? ''}
                  disabled={!editable || !enabled.includes(starterLang)}
                  onChange={(e) => set('starter_code', { ...draft.starter_code, [starterLang]: e.target.value })}
                />
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Execution limits and scoring" />
          <CardBody className="grid gap-3 sm:grid-cols-3">
            <Field label="Time limit (ms)" hint="Per test. Python and Java get 2× automatically.">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={100} max={10000} value={draft.time_limit_ms} disabled={!editable} onChange={(e) => set('time_limit_ms', Number(e.target.value))} />}
            </Field>
            <Field label="Memory limit (MB)">{({ id }) => <Input id={id} type="number" min={32} max={1024} value={draft.memory_limit_mb} disabled={!editable} onChange={(e) => set('memory_limit_mb', Number(e.target.value))} />}</Field>
            <Field label="Suggested points" hint="Used when the problem is added to an assessment.">
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} type="number" min={1} max={100} value={draft.default_points} disabled={!editable} onChange={(e) => set('default_points', Number(e.target.value))} />}
            </Field>
            <div className="sm:col-span-3">
              <Checkbox label="Partial scoring — award points for the share of test weight passed (otherwise all tests must pass)" checked={draft.partial_scoring ?? true} disabled={!editable} onChange={(e) => set('partial_scoring', e.target.checked)} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Reference solution (optional)" description="Administrators only — never sent to candidates. Used to validate the test cases once the code runner is set up." />
          <CardBody className="space-y-2">
            <Field label="Language">
              {({ id }) => (
                <select id={id} className={SELECT} value={draft.reference_language ?? ''} disabled={!editable} onChange={(e) => set('reference_language', e.target.value || null)}>
                  <option value="">—</option>
                  {enabled.map((lid) => (
                    <option key={lid} value={lid}>
                      {languages.find((l) => l.id === lid)?.name ?? lid}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <textarea aria-label="Reference solution" rows={8} spellCheck={false} className={MONO_AREA} value={draft.reference_solution ?? ''} disabled={!editable} onChange={(e) => set('reference_solution', e.target.value)} />
            {version.reference_solution && (
              <Validation version={version} dirty={dirty} validate={validate} validation={validation} onValidated={onValidated} />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4">
        {editable && version.issues.length > 0 && (
          <Card>
            <CardHeader title="Before publishing" />
            <CardBody>
              <ul className="text-ink-muted list-disc space-y-1 pl-5 text-[13px]" aria-label="Publishing issues">
                {version.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
        <TestCases version={version} editable={editable} busy={busy} onAdd={onAddTest} onUpdate={onUpdateTest} onDelete={onDeleteTest} />
        <Card>
          <CardHeader
            title="Preview"
            description="Exactly what a candidate sees. Hidden tests and the reference solution are never included."
            actions={
              <Button size="sm" variant="secondary" disabled={dirty} onClick={() => void loadPreview().then(setPreview, (err: unknown) => setPreviewError(describeError(err, 'Could not load the preview.')))}>
                {preview ? 'Refresh' : 'Show preview'}
              </Button>
            }
          />
          <CardBody>
            {dirty && <p className="text-ink-subtle text-[12.5px]">Save the draft to preview your changes.</p>}
            {previewError && <p className="text-danger text-[12.5px]">{previewError}</p>}
            {preview && <ProblemStatement problem={preview} />}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

function TestCases({
  version,
  editable,
  busy,
  onAdd,
  onUpdate,
  onDelete,
}: {
  version: Version
  editable: boolean
  busy: boolean
  onAdd: EditorProps['onAddTest']
  onUpdate: EditorProps['onUpdateTest']
  onDelete: EditorProps['onDeleteTest']
}) {
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC')
  const [input, setInput] = useState('')
  const [expected, setExpected] = useState('')
  const [weight, setWeight] = useState(1)
  const publicCount = version.test_cases.filter((t) => t.visibility === 'PUBLIC').length

  return (
    <Card>
      <CardHeader title="Test cases" description={`${publicCount} public (samples) · ${version.test_cases.length - publicCount} hidden. Hidden tests never reach candidates.`} />
      <CardBody className="space-y-3">
        <ul className="space-y-2" aria-label="Test cases">
          {version.test_cases.map((test) => (
            <li key={test.id} className="border-line rounded-md border p-2.5 text-[12.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink font-medium">
                  #{test.position + 1} · <StatusBadge tone={test.visibility === 'PUBLIC' ? 'info' : 'neutral'}>{test.visibility === 'PUBLIC' ? 'Public' : 'Hidden'}</StatusBadge> · weight {test.weight}
                </span>
                {editable && (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onUpdate(test.id, { visibility: test.visibility === 'PUBLIC' ? 'HIDDEN' : 'PUBLIC' })}>
                      Make {test.visibility === 'PUBLIC' ? 'hidden' : 'public'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onDelete(test.id)}>
                      Delete
                    </Button>
                  </span>
                )}
              </div>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                <pre className="bg-surface max-h-24 overflow-auto rounded px-2 py-1 font-mono whitespace-pre-wrap">{test.input || '(empty input)'}</pre>
                <pre className="bg-surface max-h-24 overflow-auto rounded px-2 py-1 font-mono whitespace-pre-wrap">{test.expected_output}</pre>
              </div>
            </li>
          ))}
        </ul>
        {editable && version.test_cases.length < 50 && (
          <form
            className="border-line space-y-2 rounded-md border border-dashed p-3"
            aria-label="New test case"
            onSubmit={(e) => {
              e.preventDefault()
              void onAdd({ visibility, input, expected_output: expected, weight }).then((ok) => {
                if (ok) {
                  setInput('')
                  setExpected('')
                }
              })
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Visibility">
                {({ id }) => (
                  <select id={id} className={SELECT} value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                    <option value="PUBLIC">Public (sample)</option>
                    <option value="HIDDEN">Hidden</option>
                  </select>
                )}
              </Field>
              <Field label="Weight">{({ id }) => <Input id={id} type="number" min={1} max={100} value={weight} onChange={(e) => setWeight(Number(e.target.value))} />}</Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Input (stdin)">{({ id }) => <textarea id={id} rows={3} className={MONO_AREA} value={input} onChange={(e) => setInput(e.target.value)} />}</Field>
              <Field label="Expected output">{({ id }) => <textarea id={id} rows={3} className={MONO_AREA} value={expected} onChange={(e) => setExpected(e.target.value)} />}</Field>
            </div>
            <Button type="submit" size="sm" disabled={busy || !expected.trim()}>
              Add test case
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * "Validate test cases": runs the reference solution against every test on the code runner. Publishing a
 * version with a reference solution requires a passing validation of the version as it stands.
 */
function Validation({
  version,
  dirty,
  validate,
  validation,
  onValidated,
}: {
  version: Version
  dirty: boolean
  validate(): Promise<AdminExecution>
  validation(): Promise<AdminExecution>
  onValidated(): void
}) {
  const [result, setResult] = useState<AdminExecution | null>(null)
  const [error, setError] = useState<string | null>(null)
  const running = result !== null && (result.status === 'QUEUED' || result.status === 'RUNNING')
  // The callbacks are recreated on every parent render; the effects key on the version instead.
  const load = useRef(validation)
  const done = useRef(onValidated)
  useEffect(() => {
    load.current = validation
    done.current = onValidated
  })

  useEffect(() => {
    let active = true
    load.current().then(
      (r) => active && setResult(r),
      () => undefined, // never validated yet
    )
    return () => {
      active = false
    }
  }, [version.id])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      load.current().then((r) => {
        setResult(r)
        if (r.status === 'COMPLETED' || r.status === 'FAILED') done.current()
      }, () => undefined)
    }, 1500)
    return () => window.clearInterval(timer)
  }, [running])

  const start = () => {
    setError(null)
    validate().then(setResult, (err: unknown) => setError(describeError(err, 'Could not start the validation.')))
  }

  return (
    <div className="border-line mt-2 space-y-2 rounded-md border p-3" aria-label="Validation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]">
          {version.validated_at ? (
            <span className="text-ok inline-flex items-center gap-1">
              <CheckIcon /> Validated {new Date(version.validated_at).toLocaleString()}
            </span>
          ) : (
            <span className="text-ink-muted">Not validated for this version yet.</span>
          )}
        </p>
        <Button size="sm" variant="secondary" disabled={running || dirty} onClick={start}>
          {running ? 'Validating…' : 'Validate test cases'}
        </Button>
      </div>
      {dirty && <p className="text-ink-subtle text-[12px]">Save the draft before validating.</p>}
      {error && <p className="text-danger text-[12.5px]">{error}</p>}
      {result && !running && (
        <div className="text-[12.5px]">
          <p className={cn('font-medium', result.verdict === 'ACCEPTED' ? 'text-ok' : 'text-danger')} role="status">
            {VERDICT_LABEL[result.verdict ?? ''] ?? result.status} · {result.passed ?? 0}/{result.total ?? 0} tests
            {result.runtime_ms != null ? ` · ${result.runtime_ms} ms` : ''}
          </p>
          {result.compile_output && <pre className="bg-surface mt-1 max-h-32 overflow-auto rounded px-2 py-1 font-mono whitespace-pre-wrap">{result.compile_output}</pre>}
          <ul className="mt-1 space-y-0.5" aria-label="Validation results">
            {result.results.map((r) => (
              <li key={r.test_id} className={r.verdict === 'ACCEPTED' ? 'text-ink-muted' : 'text-danger'}>
                Test #{r.number} ({r.visibility.toLowerCase()}): {VERDICT_LABEL[r.verdict] ?? r.verdict}
                {r.verdict !== 'ACCEPTED' && r.stdout ? ` — got: ${r.stdout.slice(0, 80)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
