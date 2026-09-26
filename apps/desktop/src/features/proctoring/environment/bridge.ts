/**
 * The native side of exam environment enforcement (Phase 4B), behind one small interface.
 *
 * In the packaged Windows app this calls the Tauri `lockdown_*` commands (`src-tauri/src/lockdown`):
 * real fullscreen, always-on-top, exclusion from screen capture, a system-shortcut guard, display
 * and remote-session queries. In a plain browser (the Vite dev server, the Playwright suite) those
 * protections do not exist, and the browser implementation says so — it reports them as
 * `UNAVAILABLE` and only offers what a web page can genuinely do (the HTML fullscreen API).
 *
 * Nothing here reports a protection as on because it was requested; the native side verifies each
 * one and returns what actually took effect.
 */

import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type CapabilityStatus = 'ACTIVE' | 'BEST_EFFORT' | 'UNAVAILABLE'

export interface LockdownStatus {
  fullscreen: CapabilityStatus
  alwaysOnTop: CapabilityStatus
  captureProtection: CapabilityStatus
  systemShortcutGuard: CapabilityStatus
  /** 0 when the display count cannot be determined (browser). */
  displayCount: number
  remoteSession: boolean
}

export interface WindowSnapshot {
  fullscreen: boolean
  minimized: boolean
  focused: boolean
  displayCount: number
  remoteSession: boolean
}

/** A system shortcut the native guard swallowed. Only its name — never the key stream. */
export interface NativeShortcut {
  eventType: 'KEYBOARD_RESTRICTION_ATTEMPT' | 'SCREEN_CAPTURE_ATTEMPT'
  shortcut: string
}

export interface DesktopBridge {
  /** `desktop` in the Tauri app, `browser` otherwise. Reported with the capability status. */
  environment: 'desktop' | 'browser'
  engage(): Promise<LockdownStatus>
  release(): Promise<void>
  restoreFullscreen(): Promise<boolean>
  snapshot(): Promise<WindowSnapshot>
  onShortcut(handler: (shortcut: NativeShortcut) => void): Promise<() => void>
  onWindowChange(handler: (snapshot: WindowSnapshot) => void): Promise<() => void>
}

const tauriBridge: DesktopBridge = {
  environment: 'desktop',
  engage: () => invoke<LockdownStatus>('lockdown_engage'),
  release: () => invoke<void>('lockdown_release'),
  restoreFullscreen: () => invoke<boolean>('lockdown_restore_fullscreen'),
  snapshot: () => invoke<WindowSnapshot>('environment_snapshot'),
  onShortcut: (handler) => listen<NativeShortcut>('lockdown://shortcut', (event) => handler(event.payload)),
  onWindowChange: (handler) => listen<WindowSnapshot>('lockdown://window', (event) => handler(event.payload)),
}

function browserSnapshot(): WindowSnapshot {
  return {
    fullscreen: document.fullscreenElement !== null,
    minimized: document.visibilityState === 'hidden',
    focused: document.hasFocus(),
    displayCount: 0, // a web page cannot count displays without an extra permission prompt
    remoteSession: false, // not observable from a web page
  }
}

async function requestBrowserFullscreen(): Promise<boolean> {
  if (document.fullscreenElement) return true
  try {
    await document.documentElement.requestFullscreen()
    return document.fullscreenElement !== null
  } catch {
    return false // e.g. no recent user gesture; the page offers a button instead
  }
}

const browserBridge: DesktopBridge = {
  environment: 'browser',
  async engage() {
    const fullscreen = await requestBrowserFullscreen()
    return {
      fullscreen: fullscreen ? 'ACTIVE' : 'UNAVAILABLE',
      alwaysOnTop: 'UNAVAILABLE',
      captureProtection: 'UNAVAILABLE',
      systemShortcutGuard: 'UNAVAILABLE',
      displayCount: 0,
      remoteSession: false,
    }
  },
  async release() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
  },
  restoreFullscreen: requestBrowserFullscreen,
  snapshot: async () => browserSnapshot(),
  onShortcut: async () => () => undefined, // no system-level guard in a browser
  async onWindowChange(handler) {
    const notify = () => handler(browserSnapshot())
    document.addEventListener('fullscreenchange', notify)
    return () => document.removeEventListener('fullscreenchange', notify)
  },
}

export function desktopBridge(): DesktopBridge {
  return isTauri() ? tauriBridge : browserBridge
}

export type SecurityMode = 'STANDARD' | 'SECURE_KIOSK' | 'UNKNOWN'

/**
 * Whether Windows itself is restricting this session (Secure Kiosk) or only AssessX's own controls
 * are active (Standard). Read from the OS in the desktop app; a browser cannot know, so `UNKNOWN`.
 * This is a status signal for the event log, never a security decision on its own.
 */
export async function securityMode(): Promise<SecurityMode> {
  if (!isTauri()) return 'UNKNOWN'
  try {
    const status = await invoke<{ securityMode: SecurityMode }>('kiosk_status')
    return status.securityMode
  } catch {
    return 'UNKNOWN'
  }
}
