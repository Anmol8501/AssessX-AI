import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const host = process.env.TAURI_DEV_HOST
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
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
