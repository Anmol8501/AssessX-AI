import { useState } from 'react'
import { Button, StatusBadge } from '@/components/ui'
import { cn } from '@/lib/cn'
import { eventTypeLabel } from '../monitoring/events'
import { clock, contributionLabel, durationLabel, statusLabel } from './labels'
import type { EvidenceEpisode, EvidenceItem, SourceEvent } from './types'
import { useEvidence } from './useEvidence'

type Mark = 'CONFIRMED' | 'DISMISSED'

const MARKS: Record<Mark, { label: string; tone: 'info' | 'neutral' }> = {
  CONFIRMED: { label: 'Observation confirmed', tone: 'info' },
  DISMISSED: { label: 'Dismissed', tone: 'neutral' },
}

/**
 * Optional Phase 6C review annotations. When present, each item shows the reviewer's current mark,
 * and — while `editable` — lets them confirm or dismiss it. A mark is a human annotation: it never
 * changes the evidence, its explanation or its risk points.
 */
export interface EvidenceReviewMarks {
  marks: Record<string, Mark>
  editable: boolean
  onMark(evidenceId: string, mark: Mark): Promise<unknown>
}

const RESOLUTION: Record<string, string> = {
  condition_cleared: 'Condition cleared',
  measurement_unavailable: 'No longer measurable',
  monitoring_stopped: 'Monitoring stopped',
  superseded: 'Superseded by a newer observation',
  session_ended: 'Closed when the session ended',
}

/**
 * "Proctoring evidence" (Phase 6B): the attempt's evidence, oldest first, one page at a time.
 *
 * Each row is one observed signal — its time, what it was, how long it lasted (or that no end was
 * recorded), its lifecycle status and its contribution to the Phase 6A risk. Signals the risk engine
 * correlated are bracketed as one episode. Selecting a row shows its factual explanation and the
 * stored events it came from. Evidence describes what was observed; the human reviewer decides.
 * The review screen (Phase 6C) passes `review` to show and record the reviewer's marks.
 */
export function EvidenceTimeline({
  attemptId,
  refreshKey,
  review,
}: {
  attemptId: string
  refreshKey?: string | number
  review?: EvidenceReviewMarks
}) {
  const { state, merged, first, hasMore, loadMore, loadingMore, loadSources } = useEvidence(attemptId, { refreshKey })
  const [open, setOpen] = useState<string | null>(null)

  return (
    <section className="border-line mt-4 rounded-md border p-3" aria-label="Proctoring evidence">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-ink text-[13px] font-semibold">
          Proctoring evidence{first ? ` (${first.total})` : ''}
        </h3>
        {first && <span className="text-ink-subtle text-[11px]">Evidence {first.evidenceVersion} · policy {first.policyVersion}</span>}
      </div>

      {state.status === 'loading' && <p className="text-ink-subtle mt-2 text-[12.5px]">Loading…</p>}
      {state.status === 'error' && <p className="text-ink-subtle mt-2 text-[12.5px]">Evidence is unavailable: {state.message}</p>}

      {merged && merged.items.length === 0 && <p className="text-ink-subtle mt-2 text-[12px]">No evidence recorded.</p>}

      {merged && merged.items.length > 0 && (
        <ol className="mt-2 space-y-1" aria-label="Evidence timeline">
          {merged.items.map((item, index) => {
            const episode = item.episodeId ? merged.episodes.get(item.episodeId) : undefined
            const startsEpisode = episode && merged.items[index - 1]?.episodeId !== item.episodeId
            return (
              <li key={item.evidenceId}>
                {startsEpisode && <EpisodeHeader episode={episode} />}
                <EvidenceRow
                  item={item}
                  grouped={Boolean(episode)}
                  expanded={open === item.evidenceId}
                  onToggle={() => setOpen((current) => (current === item.evidenceId ? null : item.evidenceId))}
                  loadSources={loadSources}
                  review={review}
                />
              </li>
            )
          })}
        </ol>
      )}

      {hasMore && (
        <div className="mt-2">
          <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      {first && <p className="text-ink-subtle mt-3 text-[11.5px]">{first.interpretation}</p>}
    </section>
  )
}

function EpisodeHeader({ episode }: { episode: EvidenceEpisode }) {
  return (
    <p className="text-ink-subtle mt-2 mb-1 text-[11.5px]" title={episode.explanation} data-evidence="episode">
      Correlated · {episode.memberIds.length} signals · {clock(episode.startedAt)}–{episode.endedAt ? clock(episode.endedAt) : 'open'}
    </p>
  )
}

function EvidenceRow({
  item,
  grouped,
  expanded,
  onToggle,
  loadSources,
  review,
}: {
  item: EvidenceItem
  grouped: boolean
  expanded: boolean
  onToggle(): void
  loadSources(evidenceId: string): Promise<SourceEvent[]>
  review?: EvidenceReviewMarks
}) {
  const status = statusLabel(item.status)
  const duration = durationLabel(item)
  const [sources, setSources] = useState<SourceEvent[] | null>(null)
  const mark = review?.marks[item.evidenceId]

  const toggle = () => {
    onToggle()
    if (!expanded && sources === null) void loadSources(item.evidenceId).then(setSources).catch(() => setSources([]))
  }

  return (
    <div className={cn('rounded-sm', grouped && 'border-accent border-l-2 pl-2')}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="hover:bg-surface flex w-full items-start justify-between gap-3 rounded-sm px-1 py-1 text-left text-[12.5px]"
      >
        <span className="min-w-0">
          <span className="text-ink-subtle tabular-nums">{clock(item.startedAt)}</span>{' '}
          <span className="text-ink font-medium">{eventTypeLabel(item.eventType)}</span>
          {duration && <span className="text-ink-subtle"> · {duration}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-ink-subtle text-[11.5px] tabular-nums">{contributionLabel(item)}</span>
          {item.status !== 'INSTANT' && <StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
          {mark && (
            <StatusBadge tone={MARKS[mark].tone} className="border-line border">
              {MARKS[mark].label}
            </StatusBadge>
          )}
        </span>
      </button>
      {expanded && (
        <div className="text-ink mb-2 ml-1 space-y-1 text-[12px]" data-evidence="details">
          <p>{item.explanation}</p>
          {item.resolution && <p className="text-ink-subtle">Ended: {RESOLUTION[item.resolution] ?? item.resolution}</p>}
          <p className="text-ink-subtle">
            Started {clock(item.startedAt)}
            {item.endedAt && item.status !== 'INSTANT' ? ` · ended ${clock(item.endedAt)}` : ''} · risk points now {item.currentPoints.toFixed(1)}
          </p>
          {sources && sources.length > 0 && (
            <p className="text-ink-subtle">
              Source events:{' '}
              {sources.map((s) => `${eventTypeLabel(s.eventType)} (${clock(s.recordedAt)}, ${s.source === 'SERVER' ? 'server' : 'candidate app'})`).join('; ')}
            </p>
          )}
          {review?.editable && (
            <div className="flex items-center gap-2 pt-1" data-evidence="review-mark">
              <span className="text-ink-subtle text-[11.5px]">Your review:</span>
              {(['CONFIRMED', 'DISMISSED'] as const).map((value) => (
                <Button
                  key={value}
                  variant={mark === value ? 'primary' : 'secondary'}
                  size="sm"
                  aria-pressed={mark === value}
                  onClick={() => void review.onMark(item.evidenceId, value)}
                >
                  {value === 'CONFIRMED' ? 'Confirm observation' : 'Dismiss'}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
