import type { HeadCalibrationConfig } from './config'

/**
 * Phase 5C: a candidate's neutral head yaw, calibrated once at the start of monitoring.
 *
 * Why: a fixed yaw limit judges the camera's position as much as the candidate's head. In the
 * webcam validation a candidate's "looking at the screen" yaw sat anywhere between −3° and −12°
 * depending on how they sat, so a turn is measured as a deviation from their own neutral instead.
 *
 * How (all PROVISIONAL, see `HeadCalibrationConfig`):
 *   * Only usable frames count: exactly one face and a finite head-pose yaw within ±`maxAbsYawDeg`.
 *     A frame without one (no face, several faces, landmarker failed, implausible yaw) **breaks the
 *     run** — calibration never bridges a gap with unknown data.
 *   * The neutral is the median of the first run of `samples` consecutive usable yaws whose spread
 *     (max − min) is at most `maxSpreadDeg`; a run that is too spread out slides forward, so an
 *     outlier or a candidate still settling is never locked in.
 *   * Once set, the neutral is **fixed** for this monitoring run. It does not drift with later
 *     frames, so a long head turn (an open episode) can never become the new "normal".
 *
 * Until calibrated, head orientation is unmeasurable (`unknown`), never "forward".
 */

export type HeadCalibrationState =
  | { status: 'calibrating'; stableSamples: number }
  | { status: 'calibrated'; neutralYawDeg: number; calibratedAt: number }

export class HeadCalibrator {
  private readonly config: HeadCalibrationConfig
  private run: number[] = []
  private neutral: { yaw: number; at: number } | null = null

  constructor(config: HeadCalibrationConfig) {
    this.config = config
  }

  /** The calibrated neutral yaw (degrees), or null while still calibrating. */
  get neutralYawDeg(): number | null {
    return this.neutral?.yaw ?? null
  }

  get state(): HeadCalibrationState {
    return this.neutral
      ? { status: 'calibrated', neutralYawDeg: this.neutral.yaw, calibratedAt: this.neutral.at }
      : { status: 'calibrating', stableSamples: this.run.length }
  }

  /** Offers one processed frame's yaw — null when the frame has no usable measurement. */
  offer(yawDeg: number | null, at: number): void {
    if (this.neutral) return // fixed once calibrated
    if (yawDeg === null || !Number.isFinite(yawDeg) || Math.abs(yawDeg) > this.config.maxAbsYawDeg) {
      this.run = [] // unknown / invalid data never contributes, and breaks the run
      return
    }
    this.run.push(yawDeg)
    if (this.run.length > this.config.samples) this.run.shift()
    if (this.run.length < this.config.samples) return
    if (Math.max(...this.run) - Math.min(...this.run) > this.config.maxSpreadDeg) return // not stable yet
    const sorted = [...this.run].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    const median = sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
    this.neutral = { yaw: Math.round(median * 100) / 100, at }
  }
}
