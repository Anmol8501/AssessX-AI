import { EyeIcon, SpinnerIcon } from '@/components/icons'
import { cn } from '@/lib/cn'
import type { AIHealth } from './types'

/**
 * The exam header's AI-monitoring indicator (Phase 5A).
 *
 * Strictly technical and factual: it says whether AI *perception* is running, starting, limited or
 * unavailable — never anything about the candidate, and never a cheating/percentage/verdict label
 * (KB §56, plan 5C.6). When AI monitoring is limited or unavailable it shows the plain reason
 * (e.g. no model installed yet, or the camera is unavailable) rather than implying anything is wrong
 * with the person.
 */
const LABEL: Record<AIHealth['state'], string> = {
  INITIALIZING: 'starting…',
  RUNNING: 'active',
  DEGRADED: 'limited',
  ERROR: 'unavailable',
  STOPPED: 'stopped',
}

const TONE: Record<AIHealth['state'], string> = {
  INITIALIZING: 'text-ink-subtle',
  RUNNING: 'text-ok',
  DEGRADED: 'text-warn',
  ERROR: 'text-danger',
  STOPPED: 'text-ink-subtle',
}

export function AIStatus({ health }: { health: AIHealth }) {
  if (health.state === 'STOPPED') return null
  const tone = TONE[health.state]
  const detail = health.reason ?? undefined

  return (
    <span
      className="flex items-center gap-1.5"
      role="status"
      aria-label={`AI monitoring: ${LABEL[health.state]}`}
      title={detail}
    >
      <span className={cn('text-[15px]', tone)}>{health.state === 'INITIALIZING' ? <SpinnerIcon /> : <EyeIcon />}</span>
      <span className={cn('text-[12px] font-medium', tone)}>AI {LABEL[health.state]}</span>
    </span>
  )
}
