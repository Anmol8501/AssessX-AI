/**
 * The admin-facing risk state of one attempt (Phase 6A) — `backend/app/schemas/risk.py`.
 *
 * A summary of observable signals for a human reviewer. There is no "cheated", "rejected" or
 * probability field, and the app never computes risk itself: every number here is the server's.
 */

export type RiskLevel = 'NORMAL' | 'LOW' | 'MEDIUM' | 'HIGH'

export interface RiskContributor {
  eventType: string
  tier: 'LOW' | 'MEDIUM' | 'HIGH'
  occurrences: number
  totalSeconds: number
  /** Points before decay (its part of the peak). */
  points: number
  /** Points still counting now, after decay (its part of the current score). */
  currentPoints: number
  reason: string
}

export interface RiskWindow {
  startedAt: string
  endedAt: string
  eventTypes: string[]
  signalCount: number
  bonusPoints: number
}

export interface AttemptRisk {
  attemptId: string
  policyVersion: string
  calculatedAt: string
  asOf: string
  currentScore: number
  level: RiskLevel
  peakScore: number
  peakLevel: RiskLevel
  peakAt: string | null
  signalCount: number
  contributors: RiskContributor[]
  correlatedWindows: RiskWindow[]
  correlatedWindowCount: number
  aiUnavailableSeconds: number
  interpretation: string
  limitations: string
}

type Raw = Record<string, unknown>

export function toRisk(raw: Raw): AttemptRisk {
  return {
    attemptId: raw.attempt_id as string,
    policyVersion: raw.policy_version as string,
    calculatedAt: raw.calculated_at as string,
    asOf: raw.as_of as string,
    currentScore: raw.current_score as number,
    level: raw.level as RiskLevel,
    peakScore: raw.peak_score as number,
    peakLevel: raw.peak_level as RiskLevel,
    peakAt: (raw.peak_at as string | null) ?? null,
    signalCount: raw.signal_count as number,
    contributors: ((raw.contributors as Raw[]) ?? []).map((c) => ({
      eventType: c.event_type as string,
      tier: c.tier as RiskContributor['tier'],
      occurrences: c.occurrences as number,
      totalSeconds: c.total_seconds as number,
      points: c.points as number,
      currentPoints: c.current_points as number,
      reason: c.reason as string,
    })),
    correlatedWindows: ((raw.correlated_windows as Raw[]) ?? []).map((w) => ({
      startedAt: w.started_at as string,
      endedAt: w.ended_at as string,
      eventTypes: (w.event_types as string[]) ?? [],
      signalCount: w.signal_count as number,
      bonusPoints: w.bonus_points as number,
    })),
    correlatedWindowCount: (raw.correlated_window_count as number) ?? 0,
    aiUnavailableSeconds: (raw.ai_unavailable_seconds as number) ?? 0,
    interpretation: raw.interpretation as string,
    limitations: raw.limitations as string,
  }
}
