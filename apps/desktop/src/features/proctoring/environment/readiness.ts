/**
 * Device readiness (Phase 4B.5): the pre-exam check for prohibited applications, behind the same
 * desktop/browser split as the rest of environment enforcement (`bridge.ts`).
 *
 * In the packaged Windows app this calls the native `readiness_*` commands, which look only at
 * applications with a visible window and only report ones on an explicit prohibited list — never a
 * full process list, path or command line, and never anything protected. In a plain browser there
 * is no way to see other applications, so the browser implementation reports the check as
 * unsupported and detects nothing.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'

export type AppCategory =
  | 'browser'
  | 'communication'
  | 'remote-control'
  | 'screen-recording'
  | 'ai-assistant'
  | 'developer-tool'
  | 'terminal'
  | 'virtualization'
  | 'other'

/** A prohibited application detected on the candidate's machine. `id` is a policy id, not a path. */
export interface DetectedApp {
  id: string
  displayName: string
  category: AppCategory
}

export interface ReadinessBridge {
  /** True only where other applications can actually be inspected (the desktop app). */
  supported: boolean
  scan(): Promise<DetectedApp[]>
  /** Ask the named apps to close gracefully, then return what is still open. */
  closeApps(ids: string[]): Promise<DetectedApp[]>
}

const tauriReadiness: ReadinessBridge = {
  supported: true,
  scan: () => invoke<DetectedApp[]>('readiness_scan'),
  closeApps: async (ids) => (await invoke<{ remaining: DetectedApp[] }>('readiness_close_apps', { ids })).remaining,
}

const browserReadiness: ReadinessBridge = {
  supported: false,
  scan: async () => [], // a web page cannot see other applications
  closeApps: async () => [],
}

export function readinessBridge(): ReadinessBridge {
  // A test seam: the end-to-end suite installs a scriptable bridge on `window`, since a browser
  // cannot inspect real applications. It is never present in the packaged app.
  const injected = (globalThis as { __assessxReadiness?: ReadinessBridge }).__assessxReadiness
  if (injected) return injected
  return isTauri() ? tauriReadiness : browserReadiness
}
