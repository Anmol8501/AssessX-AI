import type { AIPipelineView, Observation } from '../types'
import { AI_EVENT_TYPES, DEFAULT_AI_EVENT_CONFIG, PRODUCED_EVENT_TYPES, type AIEventConfig, type AIEventType } from './config'
import { calibrationYaw, readConditions, unknownConditions, type ConditionReading, type EventMetadata } from './conditions'
import { HeadCalibrator, type HeadCalibrationState } from './headCalibration'
import { ConditionStabilizer } from './stabilizer'
import { aiStatusOf, sameStatus, type AIStatusReport } from './status'

/**
 * Phase 5C: the one place AI observations become proctoring events.
 *
 * Detectors stay pure normalisers (Phase 5B); nothing here runs inside them. For every processed
 * frame the processor reads each condition (`conditions.ts`), debounces it (`stabilizer.ts`) and,
 * when a condition has held long enough, reports an episode **start**; when it has cleared (or
 * could not be measured for a while, or monitoring stops) it reports the episode's **resolution**.
 * An episode is exactly two events sharing an `episode_id` — nothing is reported per frame, and the
 * "ongoing" state lives in the open episode itself (the server derives it for the admin view).
 *
 * The AI's technical health is reported separately as `AI_STATUS`, only when it changes and has
 * held for `statusStableMs`, so a borderline latency cannot flood the log.
 *
 * What is reported is factual: which condition, when, for how long, and the measurement that
 * triggered it. There is no score, no severity and no statement about the candidate's intent;
 * phone / object-detection output is never reported, and neither is `GAZE_AWAY` (disabled: see
 * `DISABLED_EVENT_TYPES`). Head orientation is measured against the candidate's own neutral yaw,
 * calibrated once at the start (`headCalibration.ts`).
 */

/** What the processor can report about itself for diagnostics (the test seam, the webcam session). */
export interface AIEventDiagnostics {
  headCalibration: HeadCalibrationState
  openEpisodes: OpenEpisode[]
}

export type Report = (eventType: string, metadata: Record<string, string | number | boolean | string[]>) => unknown

/** An episode the processor has started and not yet resolved (persisted so a restart can close it). */
export interface OpenEpisode {
  eventType: AIEventType
  episodeId: string
}

export interface AIEventProcessorOptions {
  report: Report
  config?: AIEventConfig
  /** Monotonic clock (ms), the same one frames are stamped with. */
  now?: () => number
  newId?: () => string
  /** Called whenever the set of open episodes changes, so the caller can persist it. */
  onOpenEpisodesChanged?: (open: OpenEpisode[]) => void
}

export class AIEventProcessor {
  private readonly report: Report
  private readonly config: AIEventConfig
  private readonly now: () => number
  private readonly newId: () => string
  private readonly onOpenChanged: (open: OpenEpisode[]) => void
  private readonly stabilizers: Partial<Record<AIEventType, ConditionStabilizer>>
  private readonly headCalibrator: HeadCalibrator
  private readonly open = new Map<AIEventType, string>()

  private lastFrameAt: number | null = null
  private reportedStatus: AIStatusReport | null = null
  private candidateStatus: { report: AIStatusReport; since: number } | null = null
  private stopped = false

  constructor(options: AIEventProcessorOptions) {
    this.report = options.report
    this.config = options.config ?? DEFAULT_AI_EVENT_CONFIG
    this.now = options.now ?? (() => performance.now())
    this.newId = options.newId ?? (() => crypto.randomUUID())
    this.onOpenChanged = options.onOpenEpisodesChanged ?? (() => {})
    // Only produced types get a stabilizer: a disabled type (GAZE_AWAY) can never start an episode.
    this.stabilizers = {}
    for (const type of PRODUCED_EVENT_TYPES) this.stabilizers[type] = new ConditionStabilizer(this.config.timing[type])
    this.headCalibrator = new HeadCalibrator(this.config.headCalibration)
  }

  /**
   * Closes episodes a previous run of the app left open (it quit or crashed mid-episode). They are
   * resolved as `monitoring_stopped`; the server computes their duration and, if the id is no
   * longer open there, rejects the resolution — nothing is invented either way.
   */
  closeLeftovers(leftovers: OpenEpisode[]): void {
    for (const episode of leftovers) {
      if (!AI_EVENT_TYPES.includes(episode.eventType)) continue
      this.report(episode.eventType, { phase: 'resolved', episode_id: episode.episodeId, resolution: 'monitoring_stopped' })
    }
  }

  /** One processed frame's observations, stamped with the frame's monotonic time. */
  observeFrame(observations: Observation[], at: number): void {
    if (this.stopped) return
    this.lastFrameAt = at
    this.headCalibrator.offer(calibrationYaw(observations), at)
    this.apply(readConditions(observations, this.config.thresholds, this.headCalibrator.neutralYawDeg), at, true)
  }

  /** The pipeline's latest view: feeds the AI_STATUS reporter. */
  observeHealth(view: AIPipelineView): void {
    if (this.stopped) return
    const next = aiStatusOf(view)
    if (next.ai_status === 'STOPPED') return // stop() reports the end of monitoring itself
    if (sameStatus(next, this.candidateStatus?.report ?? null)) return
    this.candidateStatus = { report: next, since: this.now() }
    this.commitStatus()
  }

  /**
   * Time-based transitions: commits a stable status change, and — when no frame has been processed
   * for `frameStaleMs` (camera lost, AI stopped or failed) — treats every condition as unmeasurable,
   * so open episodes end as `measurement_unavailable` instead of lasting forever.
   */
  tick(): void {
    if (this.stopped) return
    const at = this.now()
    this.commitStatus()
    if (this.lastFrameAt === null || at - this.lastFrameAt >= this.config.frameStaleMs) {
      this.apply(unknownConditions(), at, false)
    }
  }

  /** Monitoring is ending: resolves every open episode (`monitoring_stopped`) and reports STOPPED. */
  stop(): void {
    if (this.stopped) return
    for (const [type, episodeId] of [...this.open]) this.resolve(type, episodeId, 'monitoring_stopped')
    // Only a status that was actually reported gets a STOPPED to end it; a pipeline torn down before
    // its status settled (e.g. React StrictMode's development remount) reports nothing.
    if (this.reportedStatus) this.report('AI_STATUS', { ai_status: 'STOPPED', ai_reason: 'stopped', impaired: [] })
    this.stopped = true
  }

  diagnostics(): AIEventDiagnostics {
    return { headCalibration: this.headCalibrator.state, openEpisodes: this.openEpisodes() }
  }

  /** The episodes currently open, for tests and diagnostics. */
  openEpisodes(): OpenEpisode[] {
    return [...this.open].map(([eventType, episodeId]) => ({ eventType, episodeId }))
  }

  // -- internals ---------------------------------------------------------------------------

  private apply(readings: Record<AIEventType, ConditionReading>, at: number, countsAsFrame: boolean): void {
    for (const type of PRODUCED_EVENT_TYPES) {
      const reading = readings[type]
      const decision = this.stabilizers[type]!.update(reading.state, at, countsAsFrame)
      if (decision.kind === 'start') this.start(type, reading.metadata)
      else if (decision.kind === 'resolve') {
        const episodeId = this.open.get(type)
        if (episodeId) this.resolve(type, episodeId, decision.resolution)
      }
    }
  }

  private start(type: AIEventType, metadata: EventMetadata): void {
    const episodeId = this.newId()
    this.open.set(type, episodeId)
    this.report(type, { phase: 'started', episode_id: episodeId, ...metadata })
    this.onOpenChanged(this.openEpisodes())
  }

  private resolve(type: AIEventType, episodeId: string, resolution: string): void {
    // The stabilizer is already in its cooldown when it decided this; it is not reset here.
    this.open.delete(type)
    this.report(type, { phase: 'resolved', episode_id: episodeId, resolution })
    this.onOpenChanged(this.openEpisodes())
  }

  private commitStatus(): void {
    const candidate = this.candidateStatus
    if (!candidate || sameStatus(candidate.report, this.reportedStatus)) return
    if (this.now() - candidate.since < this.config.statusStableMs) return
    this.reportedStatus = candidate.report
    this.report('AI_STATUS', { ...candidate.report })
  }
}
