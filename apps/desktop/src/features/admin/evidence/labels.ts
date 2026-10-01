/**
 * Neutral labels for the evidence timeline (Phase 6B). They describe observed facts and lifecycle —
 * never intent or a verdict. No such wording may be added here.
 */

import type { StatusTone } from '@/components/ui'
import type { EvidenceItem, EvidenceStatus } from './types'

const STATUS: Record<EvidenceStatus, { label: string; tone: StatusTone }> = {
  INSTANT: { label: 'Single event', tone: 'neutral' },
  ONGOING: { label: 'Ongoing', tone: 'warn' },
  RESOLVED: { label: 'Resolved', tone: 'neutral' },
  NO_END_RECORDED: { label: 'No end recorded', tone: 'warn' },
}

export function statusLabel(status: EvidenceStatus): { label: string; tone: StatusTone } {
  return STATUS[status] ?? { label: status, tone: 'neutral' }
}

const TIERS = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' } as const

export function contributionLabel(item: Pick<EvidenceItem, 'tier' | 'points'>): string {
  return `${TIERS[item.tier] ?? item.tier} · ${item.points.toFixed(1).replace(/\.0$/, '')} pts`
}

/** The recorded duration, or what was counted with an honest qualifier when no end was recorded. */
export function durationLabel(item: Pick<EvidenceItem, 'status' | 'durationSeconds' | 'countedSeconds'>): string {
  const fmt = (s: number) => (s < 60 ? `${s.toFixed(1).replace(/\.0$/, '')} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`)
  if (item.status === 'INSTANT') return ''
  if (item.status === 'RESOLVED' && item.durationSeconds !== null) return fmt(item.durationSeconds)
  if (item.status === 'ONGOING') return `${fmt(item.countedSeconds)} so far`
  return `no end recorded (${fmt(item.countedSeconds)} counted)`
}

export function clock(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString()
}
