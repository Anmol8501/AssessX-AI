/**
 * The admin evidence timeline (Phase 6B) — `backend/app/schemas/evidence.py`.
 *
 * Evidence describes what the proctoring system observed; it does not determine intent or prove
 * anything. The app computes none of it: every item, time, duration and point is the server's.
 */

export type EvidenceStatus = 'INSTANT' | 'ONGOING' | 'RESOLVED' | 'NO_END_RECORDED'

export interface EvidenceItem {
  evidenceId: string
  eventType: string
  category: string
  kind: 'INSTANT' | 'INTERVAL'
  status: EvidenceStatus
  startedAt: string
  /** Only a recorded end; null when none was recorded (never estimated). */
  endedAt: string | null
  durationSeconds: number | null
  /** What the risk score counted (up to now, or to the session's end, when no end was recorded). */
  countedSeconds: number
  resolution: string | null
  tier: 'LOW' | 'MEDIUM' | 'HIGH'
  points: number
  currentPoints: number
  episodeId: string | null
  sourceEventIds: string[]
  explanation: string
}

export interface EvidenceEpisode {
  episodeId: string
  startedAt: string
  endedAt: string | null
  status: EvidenceStatus
  memberIds: string[]
  eventTypes: string[]
  bonusPoints: number
  explanation: string
}

export interface EvidencePage {
  total: number
  items: EvidenceItem[]
  episodes: EvidenceEpisode[]
  nextCursor: string | null
  sessionLive: boolean
  policyVersion: string
  evidenceVersion: string
  interpretation: string
}

export interface SourceEvent {
  eventId: string
  eventType: string
  source: 'CLIENT' | 'SERVER'
  recordedAt: string
}

type Raw = Record<string, unknown>

export function toItem(raw: Raw): EvidenceItem {
  return {
    evidenceId: raw.evidence_id as string,
    eventType: raw.event_type as string,
    category: raw.category as string,
    kind: raw.kind as EvidenceItem['kind'],
    status: raw.status as EvidenceStatus,
    startedAt: raw.started_at as string,
    endedAt: (raw.ended_at as string | null) ?? null,
    durationSeconds: (raw.duration_seconds as number | null) ?? null,
    countedSeconds: (raw.counted_seconds as number) ?? 0,
    resolution: (raw.resolution as string | null) ?? null,
    tier: raw.tier as EvidenceItem['tier'],
    points: raw.points as number,
    currentPoints: raw.current_points as number,
    episodeId: (raw.episode_id as string | null) ?? null,
    sourceEventIds: (raw.source_event_ids as string[]) ?? [],
    explanation: raw.explanation as string,
  }
}

export function toEpisode(raw: Raw): EvidenceEpisode {
  return {
    episodeId: raw.episode_id as string,
    startedAt: raw.started_at as string,
    endedAt: (raw.ended_at as string | null) ?? null,
    status: raw.status as EvidenceStatus,
    memberIds: (raw.member_ids as string[]) ?? [],
    eventTypes: (raw.event_types as string[]) ?? [],
    bonusPoints: (raw.bonus_points as number) ?? 0,
    explanation: raw.explanation as string,
  }
}

export function toPage(raw: Raw): EvidencePage {
  return {
    total: (raw.total as number) ?? 0,
    items: ((raw.items as Raw[]) ?? []).map(toItem),
    episodes: ((raw.episodes as Raw[]) ?? []).map(toEpisode),
    nextCursor: (raw.next_cursor as string | null) ?? null,
    sessionLive: raw.session_live === true,
    policyVersion: raw.policy_version as string,
    evidenceVersion: raw.evidence_version as string,
    interpretation: raw.interpretation as string,
  }
}

export function toSourceEvents(raw: Raw): SourceEvent[] {
  return ((raw.source_events as Raw[]) ?? []).map((e) => ({
    eventId: e.event_id as string,
    eventType: e.event_type as string,
    source: e.source as SourceEvent['source'],
    recordedAt: e.recorded_at as string,
  }))
}

/** Pages appended in order; a later page's episodes are merged by id. */
export function mergePages(pages: EvidencePage[]): { items: EvidenceItem[]; episodes: Map<string, EvidenceEpisode> } {
  const items: EvidenceItem[] = []
  const seen = new Set<string>()
  const episodes = new Map<string, EvidenceEpisode>()
  for (const p of pages) {
    for (const item of p.items) {
      if (seen.has(item.evidenceId)) continue
      seen.add(item.evidenceId)
      items.push(item)
    }
    for (const e of p.episodes) episodes.set(e.episodeId, e)
  }
  return { items, episodes }
}
