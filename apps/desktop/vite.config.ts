import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const host = process.env.TAURI_DEV_HOST
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

/**
 * Refuses to build when the desktop app's Content-Security-Policy (src-tauri/tauri.conf.json)
 * would block the API it is built for. The app calls the API over HTTP(S) *and* opens the live
 * monitoring WebSockets (ws/wss) to the same host; in Chromium/WebView2 a `https://host` source does
 * not allow `wss://host`, so both must be listed. A missing entry used to ship silently as an
 * installer whose live monitoring never connected.
 */
function apiCspGuard(): Plugin {
  return {
    name: 'assessx-api-csp-guard',
    apply: 'build',
    configResolved(config) {
      const raw = loadEnv(config.mode, config.root, 'VITE_').VITE_API_BASE_URL?.trim()
      // Phase 8B (BX-11): a production build must name its API, over HTTPS. Without this it used to fall
      // back silently to http://127.0.0.1:8000 and ship an installer that talks to nothing (or to
      // whatever listens on the candidate's own machine). A deliberate local build (benchmarks) can opt
      // out with ASSESSX_ALLOW_INSECURE_API=1.
      const insecureAllowed = process.env.ASSESSX_ALLOW_INSECURE_API === '1'
      if (config.mode === 'production' && !insecureAllowed) {
        if (!raw) throw new Error('VITE_API_BASE_URL must be set for a production build (see .env.production.example).')
        if (!raw.startsWith('https://')) throw new Error(`VITE_API_BASE_URL must use https:// in a production build (got ${raw}).`)
      }
      if (!raw) return // a development or opted-in build uses the local development API
      const api = new URL(raw)
      const wsScheme = api.protocol === 'https:' ? 'wss:' : 'ws:'
      const required = [`${api.protocol}//${api.host}`, `${wsScheme}//${api.host}`]
      // A release is checked against the release policy; a development build against the development
      // policy (src-tauri/tauri.dev.conf.json), which alone allows the local API.
      const confFile = config.mode === 'production' ? './src-tauri/tauri.conf.json' : './src-tauri/tauri.dev.conf.json'
      const tauri = JSON.parse(readFileSync(new URL(confFile, import.meta.url), 'utf8')) as {
        app?: { security?: { csp?: string } }
      }
      const connectSrc = (tauri.app?.security?.csp ?? '')
        .split(';')
        .map((directive) => directive.trim().split(/\s+/))
        .find(([name]) => name === 'connect-src')
        ?.slice(1) ?? []
      const missing = required.filter((source) => !connectSrc.includes(source))
      if (missing.length > 0) {
        throw new Error(
          `VITE_API_BASE_URL is ${raw}, but src-tauri/tauri.conf.json's CSP connect-src does not allow ` +
            `${missing.join(' and ')}. Add ${missing.length > 1 ? 'them' : 'it'} or the installed app cannot reach the API / live monitoring.`,
        )
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), apiCspGuard()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // ONNX Runtime Web (opt-in YOLOX-Tiny path): use the build that loads its WebAssembly from
      // `ort.env.wasm.wasmPaths` at run time. The default "bundle" build would copy its ~27 MB
      // WebAssembly into every build, even with YOLOX disabled; this way the runtime files ship only
      // when a build enables YOLOX (scripts/fetch-ai-assets.mjs).
      'onnxruntime-web/webgpu': fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs', import.meta.url)),
    },
  },

  // Surfaced in the UI (welcome screen footer). Kept in sync with src-tauri/tauri.conf.json.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },

  // Vite options tailored for Tauri development; only relevant under `tauri dev` / `tauri build`.
  // 1. Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  // 2. Tauri expects a fixed port; fail if it is unavailable.
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    // 3. Don't watch the Rust crate.
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
