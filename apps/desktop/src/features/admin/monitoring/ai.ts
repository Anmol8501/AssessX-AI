/**
 * Neutral labels for the on-device AI's state in admin monitoring (Phase 5C).
 *
 * They describe what the AI measured or whether it is working — nothing more. There is no
 * "cheating", "suspicious", "violation" or "risk" wording, and none may be added: an AI observation
 * is a factual reading of the camera image, and Phase 5C does not determine whether a candidate
 * cheated. "Unknown" is shown whenever the AI is not measuring — never a reassuring default.
 */

import type { StatusTone } from '@/components/ui'
import type { AIActiveObservation, AIMonitoringState } from './types'

export const AI_OBSERVATION_LABELS: Record<string, string> = {
  FACE_NOT_DETECTED: 'Face not detected',
  MULTIPLE_FACES_DETECTED: 'Multiple faces detected',
  HEAD_ORIENTATION_CHANGED: 'Head orientation changed',
  GAZE_AWAY: 'Gaze directed away', // disabled since 2026-09-30; kept only to label earlier rows
  CAMERA_TOO_DARK: 'Camera image too dark',
  FACE_TOO_FAR: 'Face far from camera',
  FACE_TOO_CLOSE: 'Face very close to camera',
  UPPER_BODY_NOT_VISIBLE: 'Head and chest not fully in view',
  PHONE_DETECTED: 'Mobile phone in view',
  BOOK_DETECTED: 'Book in view',
  LAPTOP_DETECTED: 'Another laptop or tablet in view',
  HANDHELD_DEVICE_DETECTED: 'Handheld device in view',
}

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  INITIALIZING: { label: 'Starting', tone: 'neutral' },
  RUNNING: { label: 'Running', tone: 'ok' },
  DEGRADED: { label: 'Degraded', tone: 'warn' },
  ERROR: { label: 'Error', tone: 'danger' },
  STOPPED: { label: 'Stopped', tone: 'neutral' },
}

const REASONS: Record<string, string> = {
  no_runtime: 'AI runtime not available on this device',
  model_load_failed: 'AI model failed to load',
  runtime_error: 'AI runtime error',
  camera_unavailable: 'Camera stream unavailable to AI',
  detector_impaired: 'Some detectors are not working',
  inference_slow: 'AI running slower than expected',
}

const DETECTORS: Record<string, string> = {
  face_presence: 'face detection',
  face_tracking: 'face tracking',
  head_pose: 'head pose',
  gaze: 'gaze',
  object_detection: 'object detection',
  frame_quality: 'image quality',
}

export function aiStatusLabel(ai: AIMonitoringState): { label: string; tone: StatusTone; detail: string | null } {
  if (ai.status === null) return { label: 'Not reported', tone: 'neutral', detail: 'The candidate’s app has not reported AI status.' }
  const status = STATUS[ai.status] ?? { label: ai.status, tone: 'neutral' as StatusTone }
  let detail = ai.reason ? (REASONS[ai.reason] ?? null) : null
  if (ai.impaired.length > 0) {
    const names = ai.impaired.map((name) => DETECTORS[name] ?? name).join(', ')
    detail = `${detail ?? 'Not fully working'}: ${names}`
  }
  return { ...status, detail }
}

/** One indicator's text and whether it is the expected reading (`ok`) — null ok means unknown. */
export interface AIIndicator {
  label: string
  value: string
  ok: boolean | null
}

export function aiIndicators(ai: AIMonitoringState): AIIndicator[] {
  const unknown = (label: string): AIIndicator => ({ label, value: 'Unknown', ok: null })
  const face =
    ai.face === 'unknown'
      ? unknown('Face')
      : { label: 'Face', value: ai.face === 'detected' ? 'Detected' : 'Not detected', ok: ai.face === 'detected' }
  const count =
    ai.faceCount === 'unknown'
      ? unknown('Faces')
      : { label: 'Faces', value: { one: 'One', multiple: 'Multiple', none: 'None' }[ai.faceCount], ok: ai.faceCount === 'one' }
  const head =
    ai.headOrientation === 'unknown'
      ? unknown('Head')
      : {
          label: 'Head',
          value: ai.headOrientation === 'forward' ? 'Forward' : `Turned ${ai.headOrientation}`,
          ok: ai.headOrientation === 'forward',
        }
  const camera =
    ai.cameraQuality === 'unknown'
      ? unknown('Camera image')
      : { label: 'Camera image', value: ai.cameraQuality === 'good' ? 'OK' : 'Issue', ok: ai.cameraQuality === 'good' }
  const objects =
    ai.objects === 'unknown'
      ? unknown('Objects')
      : {
          label: 'Objects',
          value: ai.objects === 'none' ? 'None seen' : ai.objectsSeen.map((c) => OBJECT_NAMES[c] ?? c).join(', ') || 'Seen',
          ok: ai.objects === 'none',
        }
  // No gaze indicator: gaze is not used as an event signal (GAZE_AWAY is disabled).
  return [face, count, head, camera, objects]
}

/** Object classes as the admin view names them. */
export const OBJECT_NAMES: Record<string, string> = {
  cell_phone: 'Phone',
  book: 'Book',
  laptop: 'Laptop/tablet',
  remote: 'Handheld device',
}

/** "Head orientation changed (left)" — the observation plus its one factual detail. */
export function activeObservationLabel(observation: AIActiveObservation): string {
  const base = AI_OBSERVATION_LABELS[observation.eventType] ?? observation.eventType
  const meta = observation.metadata
  if (typeof meta.direction === 'string') return `${base} (${meta.direction})`
  if (typeof meta.face_count === 'number') return `${base} (${meta.face_count})`
  // Objects: the model's confidence when the episode started — a measurement, not a probability of misuse.
  if (typeof meta.confidence === 'number' && typeof meta.object_class === 'string') return `${base} (confidence ${Math.round(meta.confidence * 100)}%)`
  return base
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

const RESOLUTIONS: Record<string, string> = {
  condition_cleared: 'cleared',
  measurement_unavailable: 'could not be measured',
  monitoring_stopped: 'monitoring stopped',
  superseded: 'app restarted',
  session_ended: 'session ended',
}

/** The timeline label for an AI observation or AI_STATUS event. */
export function aiEventLabel(eventType: string, metadata: Record<string, unknown>): string | null {
  if (eventType === 'AI_STATUS') {
    const status = STATUS[String(metadata.ai_status)]?.label ?? String(metadata.ai_status)
    const reason = typeof metadata.ai_reason === 'string' ? REASONS[metadata.ai_reason] : undefined
    return `AI monitoring ${status.toLowerCase()}${reason ? ` — ${reason}` : ''}`
  }
  const base = AI_OBSERVATION_LABELS[eventType]
  if (!base) return null
  const detail = typeof metadata.direction === 'string' ? ` (${metadata.direction})` : typeof metadata.face_count === 'number' ? ` (${metadata.face_count})` : ''
  if (metadata.phase === 'started') return `${base}${detail} — started`
  const how = RESOLUTIONS[String(metadata.resolution)] ?? 'ended'
  const duration = typeof metadata.duration_ms === 'number' ? `after ${formatDuration(metadata.duration_ms)}, ` : ''
  return `${base} — ended (${duration}${how})`
}
