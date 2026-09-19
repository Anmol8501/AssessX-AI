/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ASSESSX_DOWNLOAD_URL?: string
  readonly VITE_ASSESSX_DOWNLOAD_AVAILABLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
