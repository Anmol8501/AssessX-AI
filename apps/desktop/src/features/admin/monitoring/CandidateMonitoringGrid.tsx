import { useState } from 'react'
import { Button } from '@/components/ui'
import { CandidateMonitoringTile } from './CandidateMonitoringTile'
import type { ConnectionState } from './status'
import type { MonitoringSession } from './types'

const PAGE_SIZE = 16

interface GridProps {
  sessions: MonitoringSession[]
  connection: ConnectionState
  onOpen(session: MonitoringSession): void
}

/**
 * The 4×4 candidate monitoring wall (Phase 4C).
 *
 * Renders dynamically from the active sessions — never sixteen hard-coded tiles. It shows up to
 * sixteen candidates per page and paginates beyond that, so the wall never opens an unbounded
 * number of live connections. (Live video is per-detail-view, so a page of tiles is state only.)
 */
export function CandidateMonitoringGrid({ sessions, connection, onOpen }: GridProps) {
  const pageCount = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE))
  const [requestedPage, setPage] = useState(0)
  // Clamp during render, so a page that emptied as candidates left falls back into range.
  const page = Math.min(requestedPage, pageCount - 1)

  const start = page * PAGE_SIZE
  const visible = sessions.slice(start, start + PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((session) => (
          <CandidateMonitoringTile
            key={session.attemptId}
            session={session}
            connection={connection}
            onOpen={() => onOpen(session)}
          />
        ))}
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 text-[13px]">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
            Previous
          </Button>
          <span className="text-ink-subtle tabular-nums">
            Page {page + 1} of {pageCount} · showing {visible.length} of {sessions.length}
          </span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pageCount - 1}>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
