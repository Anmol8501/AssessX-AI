import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { routes } from '@/app/routes'
import { Button, Card, CardBody, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, StatusBadge } from '@/components/ui'
import { DIFFICULTY_LABEL, parseTags, shownVersion, type Difficulty, type ProblemSummary } from '../types'
import { describeError, useCodingActions, useLanguages, useLibrary, type LibraryFilters } from '../useCoding'
import { DifficultyBadge, SELECT } from './parts'

/**
 * The coding-problem library (stage C1): every problem, its newest version, where it is used. Problems are
 * reusable across assessments; an assessment pins a published version, so editing a problem (which
 * creates the next version) never changes an assessment that already uses it.
 */
export function CodingProblemsPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState<LibraryFilters>({})
  const { state, reload } = useLibrary(filters)
  const languages = useLanguages()
  const actions = useCodingActions()
  const [creating, setCreating] = useState(false)

  const set = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => setFilters((f) => ({ ...f, [key]: value }))

  return (
    <>
      <PageHeader
        title="Coding Problems"
        description="A reusable library of coding problems. Assessments use a published version of each problem."
        actions={!creating ? <Button onClick={() => setCreating(true)}>+ New problem</Button> : undefined}
      />

      {creating && (
        <NewProblemForm
          onCancel={() => setCreating(false)}
          onCreate={async (input) => {
            const created = await actions.create(input)
            navigate(routes.admin.codingProblem(created.id))
          }}
        />
      )}

      <Card className="mb-4">
        <CardBody className="grid gap-3 sm:grid-cols-4" aria-label="Filters">
          <Field label="Search">
            {({ id }) => <Input id={id} placeholder="Title or slug" value={filters.search ?? ''} onChange={(e) => set('search', e.target.value)} />}
          </Field>
          <Field label="Difficulty">
            {({ id }) => (
              <select id={id} className={SELECT} value={filters.difficulty ?? ''} onChange={(e) => set('difficulty', e.target.value as Difficulty | '')}>
                <option value="">Any</option>
                {Object.entries(DIFFICULTY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Tag">
            {({ id }) => <Input id={id} placeholder="e.g. Arrays" value={filters.tag ?? ''} onChange={(e) => set('tag', e.target.value)} />}
          </Field>
          <Field label="Language">
            {({ id }) => (
              <select id={id} className={SELECT} value={filters.language ?? ''} onChange={(e) => set('language', e.target.value)}>
                <option value="">Any</option>
                {languages.state.status === 'ready' &&
                  languages.state.data.languages.map((lang) => (
                    <option key={lang.id} value={lang.id}>
                      {lang.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        </CardBody>
      </Card>

      {state.status === 'loading' && (
        <Card>
          <LoadingState title="Loading problems…" />
        </Card>
      )}
      {state.status === 'error' && (
        <Card>
          <ErrorState title="Could not load the problems" description={state.message} onRetry={() => void reload()} />
        </Card>
      )}
      {state.status === 'ready' && state.data.length === 0 && (
        <Card>
          <EmptyState title="No coding problems" description="Create a problem, add its test cases, and publish it to use it in assessments." />
        </Card>
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <Card>
          <table className="w-full text-left text-[13px]" aria-label="Coding problems">
            <thead className="text-ink-subtle border-line border-b text-[12px]">
              <tr>
                <th className="px-4 py-2.5 font-medium">Problem</th>
                <th className="px-4 py-2.5 font-medium">Difficulty</th>
                <th className="px-4 py-2.5 font-medium">Languages</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Used in</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {state.data.map((problem) => (
                <Row key={problem.id} problem={problem} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}

function Row({ problem }: { problem: ProblemSummary }) {
  const shown = shownVersion(problem)
  return (
    <tr>
      <td className="px-4 py-2.5">
        <Link to={routes.admin.codingProblem(problem.id)} className="text-accent font-medium hover:underline">
          {shown?.title ?? problem.slug}
        </Link>
        <p className="text-ink-subtle text-[12px]">
          {problem.slug}
          {shown && shown.tags.length > 0 ? ` · ${shown.tags.join(', ')}` : ''}
        </p>
      </td>
      <td className="px-4 py-2.5">{shown && <DifficultyBadge difficulty={shown.difficulty} />}</td>
      <td className="text-ink-muted px-4 py-2.5">{shown?.languages.join(', ')}</td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap gap-1">
          {problem.latest && <StatusBadge tone="ok">Published v{problem.latest.version}</StatusBadge>}
          {problem.draft && <StatusBadge tone="neutral">Draft v{problem.draft.version}</StatusBadge>}
          {!problem.is_enabled && <StatusBadge tone="warn">Disabled</StatusBadge>}
        </div>
      </td>
      <td className="text-ink-muted px-4 py-2.5 tabular-nums">{problem.used_in}</td>
      <td className="text-ink-muted px-4 py-2.5">{new Date(problem.created_at).toLocaleDateString()}</td>
    </tr>
  )
}

function NewProblemForm({
  onCreate,
  onCancel,
}: {
  onCreate(input: { title: string; difficulty: Difficulty; tags: string[] }): Promise<void>
  onCancel(): void
}) {
  const [title, setTitle] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('EASY')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onCreate({ title: title.trim(), difficulty, tags: parseTags(tags) })
    } catch (err) {
      setError(describeError(err, 'Could not create the problem.'))
      setBusy(false)
    }
  }

  return (
    <Card className="mb-4">
      <CardBody>
        <form className="grid gap-3 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end" onSubmit={submit} aria-label="New coding problem">
          <Field label="Title">
            {({ id }) => <Input id={id} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} autoFocus />}
          </Field>
          <Field label="Difficulty">
            {({ id }) => (
              <select id={id} className={SELECT} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                {Object.entries(DIFFICULTY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Tags" hint="Comma-separated, e.g. Arrays, Hashing">
            {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={tags} onChange={(e) => setTags(e.target.value)} />}
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={title.trim().length < 3}>
              Create
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </form>
        {error && (
          <p className="bg-danger-soft text-danger mt-3 rounded-md px-3 py-2 text-[13px]" role="alert">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  )
}
