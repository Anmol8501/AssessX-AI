/**
 * Neutral labels for the risk view (Phase 6A). Risk levels describe how many observable signals
 * occurred and how recently — never whether anyone cheated. No verdict wording may be added here.
 */

import type { StatusTone } from '@/components/ui'
import type { RiskLevel } from './types'

const LEVELS: Record<RiskLevel, { label: string; tone: StatusTone }> = {
  NORMAL: { label: 'Normal', tone: 'ok' },
  LOW: { label: 'Low', tone: 'neutral' },
  MEDIUM: { label: 'Medium', tone: 'warn' },
  HIGH: { label: 'High', tone: 'danger' },
}

export function riskLevel(level: RiskLevel): { label: string; tone: StatusTone } {
  return LEVELS[level] ?? { label: level, tone: 'neutral' }
}

export function formatSeconds(seconds: number): string {
  if (seconds < 1) return ''
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`
}

export function formatPoints(points: number): string {
  return points.toFixed(1).replace(/\.0$/, '')
}

export function formatTime(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString()
}
