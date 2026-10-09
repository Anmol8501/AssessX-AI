/**
 * Evidence clips in the admin review (FR-017): wire shapes and neutral labels.
 *
 * A clip is supporting context recorded around a factual event. These labels say what the clip is and
 * where it is in its life — never what it means. "Evidence: Face not detected", not a verdict; a person
 * reviews it and decides.
 */
import type { StatusTone } from '@/components/ui'
import { eventTypeLabel } from '../monitoring/events'
import type { ClipStatus, EvidenceClipRef } from './types'

export interface ClipEvent {
  eventId: string
  eventType: string
  recordedAt: string
  trigger: boolean
}

export interface EvidenceClipDetail {
  clipId: string
  status: ClipStatus
  sourceType: EvidenceClipRef['sourceType']
  hasVideo: boolean
  eventAt: string
  windowStartsAt: string
  windowEndsAt: string
  durationMs: number | null
  byteSize: number | null
  sha256: string | null
  failureReason: string | null
  retainUntil: string | null
  events: ClipEvent[]
}

type Raw = Record<string, unknown>

export function toClipDetail(raw: Raw): EvidenceClipDetail {
  return {
    clipId: raw.clip_id as string,
    status: raw.status as ClipStatus,
    sourceType: raw.source_type as EvidenceClipRef['sourceType'],
    hasVideo: Boolean(raw.has_video),
    eventAt: raw.event_at as string,
    windowStartsAt: raw.window_starts_at as string,
    windowEndsAt: raw.window_ends_at as string,
    durationMs: (raw.duration_ms as number | null) ?? null,
    byteSize: (raw.byte_size as number | null) ?? null,
    sha256: (raw.sha256 as string | null) ?? null,
    failureReason: (raw.failure_reason as string | null) ?? null,
    retainUntil: (raw.retain_until as string | null) ?? null,
    events: ((raw.events as Raw[]) ?? []).map((e) => ({
      eventId: e.event_id as string,
      eventType: e.event_type as string,
      recordedAt: e.recorded_at as string,
      trigger: Boolean(e.trigger),
    })),
  }
}

const STATUS: Record<ClipStatus, { label: string; tone: StatusTone }> = {
  CREATING: { label: 'Clip being captured', tone: 'info' },
  READY: { label: 'Video clip', tone: 'accent' },
  FAILED: { label: 'Clip not available', tone: 'neutral' },
  EXPIRED: { label: 'Clip expired', tone: 'neutral' },
  DELETED: { label: 'Clip deleted', tone: 'neutral' },
}

export function clipStatusLabel(status: ClipStatus): { label: string; tone: StatusTone } {
  return STATUS[status] ?? { label: status, tone: 'neutral' }
}

export const SOURCE_LABEL: Record<EvidenceClipRef['sourceType'], string> = {
  PRIMARY_CAMERA: 'Main camera',
  SECONDARY_CAMERA: 'Second camera',
}

/** "Evidence: Face not detected" — the factual title of a clip. */
export function clipTitle(eventType: string): string {
  return `Evidence: ${eventTypeLabel(eventType)}`
}

export function clipDuration(ms: number | null): string {
  if (ms === null) return 'length not reported'
  const seconds = Math.round(ms / 100) / 10
  return `${seconds.toFixed(1).replace(/\.0$/, '')} s`
}

const FAILURES: Record<string, string> = {
  upload_missing: 'the candidate’s app did not send the recording in time',
  recorder_unavailable: 'the candidate’s device could not record',
  recording_failed: 'the recording failed on the candidate’s device',
  capture_interrupted: 'the recording was interrupted (for example, the app restarted)',
  too_large: 'the recording exceeded the size limit',
  upload_failed: 'the recording could not be sent',
  invalid_content: 'the recording received was not a valid video',
  storage_error: 'the recording could not be stored',
}

/** Why there is no video, in plain words. The event itself is unaffected and still stands. */
export function clipUnavailableReason(detail: Pick<EvidenceClipDetail, 'status' | 'failureReason'>): string {
  switch (detail.status) {
    case 'CREATING':
      return 'The clip is still being captured or sent.'
    case 'FAILED':
      return `No video: ${FAILURES[detail.failureReason ?? ''] ?? 'the clip could not be captured'}. The event itself is recorded.`
    case 'EXPIRED':
      return 'The video was deleted when its retention period ended. Its record remains.'
    case 'DELETED':
      return 'The video was deleted by an administrator. Its record remains.'
    default:
      return ''
  }
}
