import { createMediaPipeDetectors } from './detectors'
import { DEFAULT_AI_EVENT_CONFIG, withOverrides, type AIEventConfig, type AIEventConfigOverrides, type AIEventDiagnostics } from './events'
import { MediaPipeRuntime } from './mediapipe/runtime'
import { configuredObjectModel, type ObjectModelId } from './objectDetection/models'
import type { AIPipelineConfig } from './scheduler'
import type { AIPipelineView, AIRuntime, Detector } from './types'
import { MockAIRuntime, MockDetector, ScriptedMediaPipeRuntime, type MockOptions, type ScriptedScene } from './testRuntime'

/**
 * Chooses the AI runtime and detectors for this build, and the end-to-end test seam.
 *
 * **Production (Phase 5B):** the MediaPipe runtime in a Web Worker plus the six detectors (face
 * presence/count, face tracking, head pose, gaze, phone, frame quality). This is the only path the
 * packaged app can take: `window.__assessxAI` is never defined there.
 *
 * **Test seam:** the E2E suite installs `window.__assessxAI` before the page loads to
 *   * `mock` / `createRuntime` — swap in the TEST-ONLY mock (or a custom runtime) to exercise the
 *     infrastructure deterministically,
 *   * `disableRuntime` — exercise the honest "no runtime available" path,
 *   * `config` — tune the sampling interval for fast tests, with the real runtime or a mock,
 *   * `scene` — drive the real Phase 5B detectors and Phase 5C event processor from a scripted
 *     scene (TEST-ONLY `ScriptedMediaPipeRuntime`); the test may change it while the exam runs,
 *   * `events` — shorten the Phase 5C debounce timings so episodes start and end quickly in tests.
 * The hook writes the live pipeline `state` back onto the seam for assertions.
 */
export interface AITestSeam {
  createRuntime?: () => AIRuntime
  createDetectors?: () => Detector[]
  config?: Partial<AIPipelineConfig>
  /** Build the standard mock pair with options, instead of supplying factories. TEST ONLY. */
  mock?: MockOptions
  /** Select no runtime at all, to test the unavailable path. */
  disableRuntime?: boolean
  /** Choose the object model for this page (tests of the opt-in YOLOX-Tiny path). */
  objectModel?: ObjectModelId
  /** Override the YOLOX model URL (tests of a missing or corrupted model). */
  objectModelUrl?: string
  /** Scripted input for the real detectors (TEST ONLY); read on every frame, so it can change live. */
  scene?: ScriptedScene
  /** Phase 5C debounce/threshold overrides for fast tests. */
  events?: AIEventConfigOverrides
  /** Written by the running pipeline for test assertions; never read by the app. */
  state?: AIPipelineView
  /** Written by the Phase 5C event processor (head calibration, open episodes); never read by the app. */
  eventDiagnostics?: AIEventDiagnostics
}

/**
 * The test seam exists only in development and test builds (Phase 8B, BX-06). In a production build
 * `import.meta.env.DEV` is the constant `false` and the mode is `production`, so this returns undefined
 * and the bundler removes the lookup entirely — a production app has no hook through which a script could
 * swap in the scripted or mock runtime. `scripts/check-production-bundle.mjs` verifies the built bundle.
 */
export const TEST_SEAMS_ENABLED: boolean = import.meta.env.DEV || import.meta.env.MODE === 'test'

function seam(): AITestSeam | undefined {
  if (!TEST_SEAMS_ENABLED) return undefined
  return (globalThis as { __assessxAI?: AITestSeam }).__assessxAI
}

export interface SelectedComponents {
  runtime: AIRuntime | null
  detectors: Detector[]
  config?: Partial<AIPipelineConfig>
}

/**
 * The build's object model: `VITE_OBJECT_DETECTOR_MODEL` (efficientdet_lite0 by default; yolox_tiny
 * opt-in). An unknown value is passed through so the runtime reports it as an error — it is never
 * silently replaced by the default. (The asset script also refuses such a build.)
 */
function buildObjectModel(): ObjectModelId {
  const raw = import.meta.env.VITE_OBJECT_DETECTOR_MODEL
  const configured = configuredObjectModel(raw)
  return 'model' in configured ? configured.model : (String(raw) as ObjectModelId)
}

function production(overrides: { objectModel?: ObjectModelId; objectModelUrl?: string } = {}): {
  runtime: AIRuntime | null
  detectors: Detector[]
} {
  // A Web Worker is required to keep inference off the exam's UI thread. WebView2 always has one;
  // anywhere it does not, AI monitoring reports itself unavailable rather than blocking the UI.
  if (typeof Worker === 'undefined') return { runtime: null, detectors: [] }
  const runtime = new MediaPipeRuntime({
    objectModel: overrides.objectModel ?? buildObjectModel(),
    objectModelUrl: overrides.objectModelUrl,
  })
  return { runtime, detectors: createMediaPipeDetectors() }
}

export function selectComponents(): SelectedComponents {
  // Constant in a production build: everything after this line is removed from the bundle.
  if (!TEST_SEAMS_ENABLED) return production()
  const injected = seam()
  if (!injected) return production()
  if (injected.createRuntime) {
    return { runtime: injected.createRuntime(), detectors: injected.createDetectors?.() ?? [], config: injected.config }
  }
  if (injected.scene) {
    return {
      runtime: new ScriptedMediaPipeRuntime(() => seam()?.scene ?? {}),
      detectors: createMediaPipeDetectors(),
      config: injected.config,
    }
  }
  if (injected.mock) {
    return { runtime: new MockAIRuntime(injected.mock), detectors: [new MockDetector(injected.mock)], config: injected.config }
  }
  if (injected.disableRuntime) return { runtime: null, detectors: [], config: injected.config }
  return { ...production({ objectModel: injected.objectModel, objectModelUrl: injected.objectModelUrl }), config: injected.config }
}

/** Publishes the current pipeline view onto the seam for E2E assertions, if a seam is present. */
export function publishState(view: AIPipelineView): void {
  const injected = seam()
  if (injected) injected.state = view
}

/** Publishes the event processor's diagnostics onto the seam, if a seam is present. */
export function publishEventDiagnostics(diagnostics: AIEventDiagnostics): void {
  const injected = seam()
  if (injected) injected.eventDiagnostics = diagnostics
}

/** The Phase 5C event configuration: the defaults, or the test seam's overrides. */
export function eventConfig(): AIEventConfig {
  const injected = seam()
  return injected?.events ? withOverrides(DEFAULT_AI_EVENT_CONFIG, injected.events) : DEFAULT_AI_EVENT_CONFIG
}
