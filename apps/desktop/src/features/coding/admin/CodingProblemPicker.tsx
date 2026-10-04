import { useState } from 'react'
import { Button, EmptyState, Field, Input, LoadingState } from '@/components/ui'
import { DIFFICULTY_LABEL, type Difficulty } from '../types'
import { useLibrary } from '../useCoding'
import { DifficultyBadge, SELECT } from './parts'

/**
 * Picks a coding problem to add to an assessment: the library's published, enabled problems, filtered.
 * Adding pins the problem's newest published version; problems already in the assessment are hidden.
 */
export function CodingProblemPicker({
  excludeProblemIds,
  busy,
  onPick,
  onCancel,
}: {
  excludeProblemIds: Set<string>
  busy: boolean
  onPick(versionId: string): void
  onCancel(): void
}) {
  const [search, setSearch] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('')
  const [tag, setTag] = useState('')
  const { state } = useLibrary({ search, difficulty, tag, publishedOnly: true, enabledOnly: true })
  const rows = state.status === 'ready' ? state.data.filter((p) => p.latest && !excludeProblemIds.has(p.id)) : []

  return (
    <div className="space-y-3" aria-label="Coding problem library">
      <div className="flex items-center justify-between">
        <p className="text-ink text-[13.5px] font-semibold">Add a coding problem</p>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Close
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Search">{({ id }) => <Input id={id} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Title or slug" />}</Field>
        <Field label="Difficulty">
          {({ id }) => (
            <select id={id} className={SELECT} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}>
              <option value="">Any</option>
              {Object.entries(DIFFICULTY_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Tag">{({ id }) => <Input id={id} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. Arrays" />}</Field>
      </div>
      {state.status === 'loading' && <LoadingState title="Loading problems…" />}
      {state.status === 'error' && <p className="text-danger text-[13px]">{state.message}</p>}
      {state.status === 'ready' && rows.length === 0 && (
        <EmptyState title="No published problems to add" description="Publish a problem in Coding Problems first, or clear the filters." />
      )}
      <ul className="divide-line divide-y" aria-label="Problems to add">
        {rows.map((problem) => (
          <li key={problem.id} className="flex items-center justify-between gap-3 py-2 text-[13px]">
            <div className="min-w-0">
              <p className="text-ink font-medium">{problem.latest!.title}</p>
              <p className="text-ink-subtle text-[12px]">
                v{problem.latest!.version} · {problem.latest!.languages.join(', ')}
                {problem.latest!.tags.length ? ` · ${problem.latest!.tags.join(', ')}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <DifficultyBadge difficulty={problem.latest!.difficulty} />
              <Button size="sm" disabled={busy} onClick={() => onPick(problem.latest!.id)}>
                Add
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
