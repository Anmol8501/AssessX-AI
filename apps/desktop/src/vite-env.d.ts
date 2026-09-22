/// <reference types="vite/client" />

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string

interface ImportMetaEnv {
  /** Base URL of the AssessX API. Defaults to the local backend. */
  readonly VITE_API_BASE_URL?: string
}
