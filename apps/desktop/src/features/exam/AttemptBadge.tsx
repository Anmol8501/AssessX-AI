import { StatusBadge } from '@/components/ui'
import type { AttemptStatus } from './types'

/**
 * An attempt's state as a badge.
 *
 * Status only — how the exam ended, never how it scored. There is no evaluation in this build,
 * and a badge is exactly the place a fake result would be tempting to show.
 */
export function AttemptBadge({ resuming, status }: { resuming?: boolean; status: AttemptStatus | null }) {
  if (resuming) {
    return (
      <StatusBadge tone="warn" dot>
        In progress
      </StatusBadge>
    )
  }
  if (status === 'SUBMITTED') return <StatusBadge tone="ok">Submitted</StatusBadge>
  if (status === 'TIME_EXPIRED') return <StatusBadge tone="neutral">Time expired</StatusBadge>
  return <StatusBadge tone="accent">Assigned</StatusBadge>
}
