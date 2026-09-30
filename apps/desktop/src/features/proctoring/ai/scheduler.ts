import type { Frame } from './types'

export interface AIPipelineConfig {
  /** Target interval between inferences, in ms. See `config.ts` — an infrastructure default, not a KB value. */
  inferenceIntervalMs: number
  /** Rolling-average latency above which the pipeline reports DEGRADED. */
  latencyBudgetMs: number
  /** Number of recent samples kept for the rolling average latency and FPS. */
  rollingWindow: number
}

export interface SchedulerStats {
  framesCaptured: number
  framesProcessed: number
  framesDropped: number
  framesUnavailable: number
  lastLatencyMs: number | null
  avgLatencyMs: number | null
  processedFps: number | null
}

interface SchedulerHooks {
  capture(): Promise<Frame | null>
  process(frame: Frame): Promise<void>
  /** Injectable clock for determinism; defaults to `performance.now`. */
  now?: () => number
}

/**
 * Samples the camera at a controlled rate and feeds one frame at a time to the runtime, with strict
 * backpressure (plan 5A.2, prompt §8–§9).
 *
 * **Bounded by design — the newest frame wins.** Ticks are chained: the next capture is scheduled
 * `inferenceIntervalMs` after the previous frame has *finished* processing, so at most one frame is
 * ever in flight and there is no queue at all — however slow inference is, the sampler slows down
 * with it (effective rate ≈ 1 / (interval + inference latency), reported as `processedFps`) and each
 * capture takes the camera's newest frame, never a stale one. Because ticks never overlap,
 * `framesDropped` is 0 by construction; the `busy` branch below is only a defensive guard.
 *
 * Every captured frame is `close()`d after processing — including on error — so pixel buffers are
 * always released.
 */
export class FrameScheduler {
  private readonly capture: () => Promise<Frame | null>
  private readonly process: (frame: Frame) => Promise<void>
  private readonly now: () => number
  private readonly intervalMs: number
  private readonly rollingWindow: number

  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private busy = false
  private latencies: number[] = []
  private processedTimestamps: number[] = []

  private stats: SchedulerStats = {
    framesCaptured: 0,
    framesProcessed: 0,
    framesDropped: 0,
    framesUnavailable: 0,
    lastLatencyMs: null,
    avgLatencyMs: null,
    processedFps: null,
  }

  constructor(config: AIPipelineConfig, hooks: SchedulerHooks) {
    this.capture = hooks.capture
    this.process = hooks.process
    this.now = hooks.now ?? (() => performance.now())
    this.intervalMs = Math.max(1, config.inferenceIntervalMs)
    this.rollingWindow = Math.max(1, config.rollingWindow)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.scheduleNext()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  getStats(): SchedulerStats {
    return { ...this.stats }
  }

  private scheduleNext(): void {
    if (!this.running) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.tick()
    }, this.intervalMs)
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    // Backpressure: if inference is still running, skip this tick entirely (drop) and try again
    // next interval. Only one frame is ever in flight.
    if (this.busy) {
      this.stats.framesDropped++
      this.scheduleNext()
      return
    }
    this.busy = true
    let frame: Frame | null = null
    try {
      frame = await this.capture()
      if (!frame) {
        this.stats.framesUnavailable++
        return
      }
      this.stats.framesCaptured++
      const startedAt = this.now()
      await this.process(frame)
      const latency = this.now() - startedAt
      this.recordProcessed(latency)
    } catch {
      // A failed capture or inference must never crash the exam. It is not counted as processed;
      // the pipeline's health derivation reacts to the runtime/detector state instead.
    } finally {
      frame?.close()
      this.busy = false
      this.scheduleNext()
    }
  }

  private recordProcessed(latencyMs: number): void {
    this.stats.framesProcessed++
    this.stats.lastLatencyMs = latencyMs

    this.latencies.push(latencyMs)
    if (this.latencies.length > this.rollingWindow) this.latencies.shift()
    const sum = this.latencies.reduce((total, value) => total + value, 0)
    this.stats.avgLatencyMs = sum / this.latencies.length

    const nowTs = this.now()
    this.processedTimestamps.push(nowTs)
    if (this.processedTimestamps.length > this.rollingWindow) this.processedTimestamps.shift()
    const oldest = this.processedTimestamps[0]
    if (this.processedTimestamps.length >= 2 && oldest !== undefined) {
      const spanMs = nowTs - oldest
      this.stats.processedFps = spanMs > 0 ? ((this.processedTimestamps.length - 1) * 1000) / spanMs : null
    }
  }
}
