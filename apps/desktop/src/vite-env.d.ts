/// <reference types="vite/client" />

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Base URL of the AssessX API. Defaults to the local backend. */
  readonly VITE_API_BASE_URL?: string
  /**
   * Object model for the AI phone observation: `efficientdet_lite0` (default) or `yolox_tiny`
   * (opt-in, validation only). Read at build time; see src/features/proctoring/ai/objectDetection.
   */
  readonly VITE_OBJECT_DETECTOR_MODEL?: string
}
