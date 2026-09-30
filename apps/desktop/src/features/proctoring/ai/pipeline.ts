import { DEFAULT_AI_CONFIG } from './config'
import { FrameProvider, type FrameSource } from './frameProvider'
import { deriveHealth } from './health'
import { FrameScheduler, type AIPipelineConfig } from './scheduler'
import type { AIPipelineView, AIRuntime, Detector, Frame, Observation, PipelineTelemetry } from './types'

const MAX_RECENT_OBSERVATIONS = 50

/** One processed frame's observations (no pixels — the frame is already released or about to be). */
export interface FrameObservations {
  frameId: number
  monotonicTs: number
  observations: Observation[]
}

export interface PipelineComponents {
  /** The inference engine, or null when no production model is available (Phase 5A default). */
  runtime: AIRuntime | null
  detectors: Detector[]
}

/**
 * Phase 5A AI perception pipeline: `camera stream → frame provider → scheduler → runtime →
 * detectors → observations`, with technical health and performance telemetry (plan 5A.8).
 *
 * It is framework-agnostic and owns no camera of its own — it is given the proctoring session's
 * existing stream. Its lifecycle is tied to that session by the React hook that drives it: it
 * starts when the proctored exam begins and stops (releasing the video element, the scheduler, the
 * detectors and the runtime) when the exam ends or the component unmounts.
 *
 * In the packaged app no production runtime is bundled in Phase 5A, so `runtime` is null: the
 * pipeline reports DEGRADED ("model not installed — arriving in Phase 5B") and does not touch the
 * camera. A real runtime, or the test-only mock behind the test seam, makes the full path run.
 */
export class AIPipeline {
  private readonly config: AIPipelineConfig
  private readonly runtime: AIRuntime | null
  private readonly detectors: Detector[]
  private readonly listeners = new Set<(view: AIPipelineView) => void>()
  private readonly frameListeners = new Set<(frame: FrameObservations) => void>()

  private provider: FrameSource | null = null
  private scheduler: FrameScheduler | null = null
  private recent: Observation[] = []

  private desiredStream: MediaStream | null = null
  private started = false
  private stopped = false
  private streamPresent = false
  private runtimeLoadMs: number | null = null
  private startedAt: string | null = null
  private lastStageTimingsMs: Record<string, number> | null = null
  /** Counters of the last retired scheduler, so telemetry survives a failure or the end of the exam. */
  private retiredStats: ReturnType<FrameScheduler['getStats']> | null = null

  private readonly createSource: (stream: MediaStream) => FrameSource

  constructor(
    components: PipelineComponents,
    config: AIPipelineConfig = DEFAULT_AI_CONFIG,
    /** How frames are read from a stream; the camera `FrameProvider` unless a test supplies one. */
    createSource: (stream: MediaStream) => FrameSource = (stream) => new FrameProvider(stream),
  ) {
    this.runtime = components.runtime
    this.detectors = components.detectors
    this.config = config
    this.createSource = createSource
  }

  subscribe(listener: (view: AIPipelineView) => void): () => void {
    this.listeners.add(listener)
    listener(this.getView())
    return () => this.listeners.delete(listener)
  }

  /**
   * Every processed frame's observations, as one batch (Phase 5C: the event processor reads these).
   * Frames whose inference failed produce no batch — nothing was measured.
   */
  subscribeFrames(listener: (frame: FrameObservations) => void): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  getView(): AIPipelineView {
    const stats = this.scheduler?.getStats() ?? this.retiredStats
    const telemetry: PipelineTelemetry = {
      framesCaptured: stats?.framesCaptured ?? 0,
      framesProcessed: stats?.framesProcessed ?? 0,
      framesDropped: stats?.framesDropped ?? 0,
      framesUnavailable: stats?.framesUnavailable ?? 0,
      lastLatencyMs: stats?.lastLatencyMs ?? null,
      avgLatencyMs: stats?.avgLatencyMs ?? null,
      processedFps: stats?.processedFps ?? null,
      runtimeLoadMs: this.runtimeLoadMs,
      startedAt: this.startedAt,
      runtime: this.runtime ? pickRuntimeInfo(this.runtime) : null,
      lastStageTimingsMs: this.lastStageTimingsMs,
    }
    const health = deriveHealth({
      started: this.started,
      stopped: this.stopped,
      cameraAvailable: this.streamPresent,
      runtimeState: this.runtime?.state ?? null,
      detectors: this.detectors,
      avgLatencyMs: telemetry.avgLatencyMs,
      latencyBudgetMs: this.config.latencyBudgetMs,
    })
    return { health, telemetry, recentObservations: [...this.recent] }
  }

  /** Loads the runtime and detectors, then begins sampling the current stream. Runs once. */
  async start(stream: MediaStream | null): Promise<void> {
    if (this.started || this.stopped) return
    this.startedAt = new Date().toISOString()
    this.desiredStream = stream
    this.streamPresent = hasLiveVideo(stream)

    if (this.runtime) {
      const loadStartedAt = performance.now()
      try {
        await this.runtime.load()
      } catch {
        // The runtime records LOAD_FAILED itself; health surfaces it. Do not throw.
      }
      this.runtimeLoadMs = performance.now() - loadStartedAt
    }
    for (const detector of this.detectors) {
      try {
        await detector.init()
      } catch {
        // The detector records ERROR itself; health surfaces it.
      }
    }

    this.started = true
    this.rebuild() // begins sampling only now that the runtime and detectors are loaded
    this.emit()
  }

  /**
   * Points the pipeline at a new camera stream, or `null` when the camera is lost. Sampling begins
   * only once `start()` has loaded the runtime, so a stream set during start never runs inference
   * before the model is ready. Called by the hook whenever the proctoring camera changes.
   */
  setStream(stream: MediaStream | null): void {
    if (stream === this.desiredStream && hasLiveVideo(stream) === this.streamPresent) {
      this.emit() // nothing changed: keep the running frame source rather than rebuilding it
      return
    }
    if (stream !== this.desiredStream) {
      // A different camera stream (lost, reconnected, replaced): short-lived cross-frame state such
      // as face tracks no longer refers to anything, so every detector starts afresh.
      for (const detector of this.detectors) detector.reset?.()
    }
    this.desiredStream = stream
    this.streamPresent = hasLiveVideo(stream)
    this.rebuild()
    this.emit()
  }

  /** Tears down any current provider/scheduler and, when eligible, starts fresh on the desired stream. */
  private rebuild(): void {
    this.retireSampling()

    const stream = this.desiredStream
    // Sampling requires: the pipeline started, a runtime that can still infer, a live stream, and
    // not stopped. With no usable runtime the camera is left untouched — honest and idle.
    if (this.started && !this.stopped && this.runtimeUsable() && stream && this.streamPresent) {
      const provider = this.createSource(stream)
      this.provider = provider
      void provider.start().then(() => this.emit())
      const scheduler = new FrameScheduler(this.config, {
        capture: () => provider.capture(),
        process: (frame) => this.runFrame(frame),
      })
      this.scheduler = scheduler
      scheduler.start()
    }
  }

  /** Stops sampling and releases the provider, scheduler, detectors and runtime. Idempotent. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.retireSampling()
    for (const detector of this.detectors) {
      try {
        await detector.shutdown()
      } catch {
        // Best-effort cleanup.
      }
    }
    if (this.runtime) {
      try {
        await this.runtime.unload()
      } catch {
        // Best-effort cleanup.
      }
    }
    this.emit()
  }

  /** Runs one sampled frame through the runtime and every detector. The scheduler `close()`s it. */
  private async runFrame(frame: Frame): Promise<void> {
    const runtime = this.runtime
    if (!runtime) return
    let raw
    try {
      raw = await runtime.infer(frame)
    } catch (error) {
      // Not counted as processed; health reflects the runtime's own state. If the runtime can no
      // longer infer at all (it failed or was terminated), stop sampling: capturing frames nothing
      // can process would only cost the candidate's machine work.
      if (!this.runtimeUsable()) {
        this.retireSampling()
      }
      this.emit()
      throw error
    }
    if (this.stopped) return // the exam ended while this frame was in inference: emit nothing
    this.lastStageTimingsMs = raw.timingsMs ?? null
    const observations: Observation[] = []
    for (const detector of this.detectors) {
      try {
        for (const observation of detector.process(frame, raw)) {
          observations.push(observation)
          this.pushObservation(observation)
        }
      } catch {
        // The detector marks itself ERROR/DEGRADED; health surfaces it. One detector failing must
        // not stop the others or the exam.
      }
    }
    for (const listener of this.frameListeners) {
      try {
        listener({ frameId: frame.frameId, monotonicTs: frame.monotonicTs, observations })
      } catch {
        // A consumer's failure must not stop perception.
      }
    }
    this.emit()
  }

  /** Stops sampling and releases the frame provider, keeping the scheduler's final counters. */
  private retireSampling(): void {
    if (this.scheduler) {
      this.scheduler.stop()
      this.retiredStats = this.scheduler.getStats()
    }
    this.scheduler = null
    this.provider?.stop()
    this.provider = null
  }

  /** A runtime exists and is not in a state from which it can no longer infer. */
  private runtimeUsable(): boolean {
    const state = this.runtime?.state
    return state !== undefined && state !== 'LOAD_FAILED' && state !== 'ERROR' && state !== 'STOPPING' && state !== 'STOPPED'
  }

  private pushObservation(observation: Observation): void {
    this.recent.push(observation)
    if (this.recent.length > MAX_RECENT_OBSERVATIONS) {
      this.recent.splice(0, this.recent.length - MAX_RECENT_OBSERVATIONS)
    }
  }

  private emit(): void {
    const view = this.getView()
    for (const listener of this.listeners) listener(view)
  }
}

function hasLiveVideo(stream: MediaStream | null): boolean {
  return stream !== null && stream.getVideoTracks().some((track) => track.readyState === 'live')
}

function pickRuntimeInfo(runtime: AIRuntime): NonNullable<PipelineTelemetry['runtime']> {
  const { id, version, kind, productionCapable, accelerator, objectDetector, loadErrors } = runtime.info
  return { id, version, kind, productionCapable, accelerator: accelerator ?? null, objectDetector: objectDetector ?? null, loadErrors: loadErrors ?? [] }
}
