import type { ConditionTiming } from './config'
import type { ConditionState } from './conditions'

/**
 * Phase 5C, step 2: temporal stabilisation of one condition — the debouncing that stops a single
 * noisy frame from becoming an event, and a flickering condition from becoming a stream of them.
 *
 *     idle ──present held ≥ startAfterMs over ≥ minFrames──▶ active   (→ "start")
 *     active ──absent held ≥ resolveAfterMs over ≥ minClearFrames──▶ cooldown (→ "resolve: condition_cleared")
 *     active ──unknown held ≥ unknownResolveMs──▶ cooldown            (→ "resolve: measurement_unavailable")
 *     cooldown ──cooldownMs elapsed──▶ idle
 *
 * `unknown` never starts an episode and never counts as clearing one. Pure and synchronous: the
 * caller supplies each reading with its (monotonic) time, so the behaviour is fully deterministic.
 */

export type StabilizerDecision =
  | { kind: 'none' }
  | { kind: 'start' }
  | { kind: 'resolve'; resolution: 'condition_cleared' | 'measurement_unavailable' }

const NONE: StabilizerDecision = { kind: 'none' }

type Phase =
  | { name: 'idle' }
  | { name: 'pending'; since: number; frames: number }
  | { name: 'active'; clearSince: number | null; clearFrames: number; unknownSince: number | null }
  | { name: 'cooldown'; until: number }

export class ConditionStabilizer {
  private phase: Phase = { name: 'idle' }
  private readonly timing: ConditionTiming

  constructor(timing: ConditionTiming) {
    this.timing = timing
  }

  get active(): boolean {
    return this.phase.name === 'active'
  }

  /**
   * Feeds one reading. `countsAsFrame` is false for synthetic readings (the "no frames arriving"
   * tick), which advance time but are not frames.
   */
  update(state: ConditionState, at: number, countsAsFrame = true): StabilizerDecision {
    const frame = countsAsFrame ? 1 : 0
    const t = this.timing
    let phase = this.phase

    if (phase.name === 'cooldown') {
      if (at < phase.until) return NONE
      phase = this.phase = { name: 'idle' }
    }

    switch (phase.name) {
      case 'idle':
        if (state === 'present' && frame) this.phase = this.pendingOrStart(at, 1)
        return this.phase.name === 'active' ? { kind: 'start' } : NONE

      case 'pending':
        if (state !== 'present') {
          this.phase = { name: 'idle' } // interrupted (absent or unmeasurable): start over
          return NONE
        }
        this.phase = this.pendingOrStart(phase.since, phase.frames + frame, at)
        return this.phase.name === 'active' ? { kind: 'start' } : NONE

      case 'active':
        if (state === 'present') {
          if (frame) this.phase = { name: 'active', clearSince: null, clearFrames: 0, unknownSince: null }
          return NONE
        }
        if (state === 'unknown') {
          const unknownSince = phase.unknownSince ?? at
          this.phase = { ...phase, unknownSince }
          if (at - unknownSince >= t.unknownResolveMs) return this.resolve(at, 'measurement_unavailable')
          return NONE
        }
        {
          // absent (a measured frame)
          if (!frame) return NONE
          const clearSince = phase.clearSince ?? at
          const clearFrames = phase.clearFrames + 1
          this.phase = { name: 'active', clearSince, clearFrames, unknownSince: null }
          if (at - clearSince >= t.resolveAfterMs && clearFrames >= t.minClearFrames) {
            return this.resolve(at, 'condition_cleared')
          }
          return NONE
        }
    }
  }

  /** Forgets any pending or active state without a decision (the processor resolves explicitly). */
  reset(): void {
    this.phase = { name: 'idle' }
  }

  private pendingOrStart(since: number, frames: number, at = since): Phase {
    if (at - since >= this.timing.startAfterMs && frames >= this.timing.minFrames) {
      return { name: 'active', clearSince: null, clearFrames: 0, unknownSince: null }
    }
    return { name: 'pending', since, frames }
  }

  private resolve(at: number, resolution: 'condition_cleared' | 'measurement_unavailable'): StabilizerDecision {
    this.phase = { name: 'cooldown', until: at + this.timing.cooldownMs }
    return { kind: 'resolve', resolution }
  }
}
