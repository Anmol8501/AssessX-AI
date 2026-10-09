/**
 * Pairs a local capture with the server's decision (FR-017).
 *
 * The capture has to start the moment the event is observed — the pre-event seconds are only in the
 * rolling buffer for a few seconds — but only the server decides whether the event gets a clip (policy,
 * cooldown, cap, linking to a clip already being captured). So: an eligible event starts a capture at
 * once; when the server's answer for that event arrives, the capture is uploaded to the clip id the
 * server chose, or simply discarded. The app never creates a clip and never chooses a clip id.
 *
 * Bounded: at most `maxPending` captures wait for an answer, each for at most `pendingTtlMs`.
 */
import type { RecordingPolicy } from '@/features/assessments/types'
import type { PendingEvent, RecordedEvent } from '../environment/useEventReporter'
import { CaptureError, type CaptureFailure, type CapturedClip } from './rollingRecorder'

export type ClientFailure = CaptureFailure | 'capture_interrupted' | 'upload_failed'

export interface CoordinatorOptions {
  policy: RecordingPolicy
  capture(): Promise<CapturedClip> | null
  upload(clipId: string, clip: CapturedClip): Promise<void>
  fail(clipId: string, reason: ClientFailure): Promise<void>
  now?: () => number
  maxPending?: number
  pendingTtlMs?: number
}

interface Pending {
  capture: Promise<CapturedClip> | null
  at: number
}

export function isEligible(policy: RecordingPolicy, event: Pick<PendingEvent, 'event_type' | 'metadata'>): boolean {
  return policy.enabled && policy.event_types.includes(event.event_type) && event.metadata.phase === 'started'
}

export class EvidenceCoordinator {
  private readonly pending = new Map<string, Pending>()
  private readonly options: Required<Pick<CoordinatorOptions, 'now' | 'maxPending' | 'pendingTtlMs'>> & CoordinatorOptions

  constructor(options: CoordinatorOptions) {
    this.options = {
      now: () => Date.now(),
      maxPending: 4,
      pendingTtlMs: (options.policy.post_seconds + 120) * 1000,
      ...options,
    }
  }

  get waiting(): number {
    return this.pending.size
  }

  queued(event: PendingEvent): void {
    this.prune()
    if (!isEligible(this.options.policy, event)) return
    const capture = this.options.capture()
    capture?.catch(() => {}) // settled later by `recorded`; never an unhandled rejection
    this.pending.set(event.client_event_id, { capture, at: this.options.now() })
    while (this.pending.size > this.options.maxPending) {
      const oldest = this.pending.keys().next().value as string
      this.pending.delete(oldest)
    }
  }

  recorded(event: PendingEvent, recorded: RecordedEvent): void {
    const entry = this.pending.get(event.client_event_id)
    this.pending.delete(event.client_event_id)
    const request = recorded.clip_request
    if (!request?.upload) return // no clip, or this event joined a clip another capture covers
    if (!entry?.capture) {
      // The server wants a clip we cannot provide (e.g. the app restarted, or no camera to record).
      void this.options.fail(request.clip_id, entry ? 'recorder_unavailable' : 'capture_interrupted').catch(() => {})
      return
    }
    entry.capture
      .then((clip) => this.options.upload(request.clip_id, clip))
      .catch((error: unknown) => {
        const reason: ClientFailure = error instanceof CaptureError ? error.reason : 'upload_failed'
        return this.options.fail(request.clip_id, reason)
      })
      .catch(() => {
        // Even the failure report could not be sent: the server marks the clip FAILED at its deadline.
      })
  }

  private prune(): void {
    const cutoff = this.options.now() - this.options.pendingTtlMs
    for (const [id, entry] of this.pending) if (entry.at < cutoff) this.pending.delete(id)
  }
}
