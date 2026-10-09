import { invoke } from '@tauri-apps/api/core'

/**
 * Where the bearer token lives between requests.
 *
 * * **Session only** (the default) → `sessionStorage`: in memory, gone when the window closes.
 * * **"Keep me signed in"** (candidates only; administrators are never remembered) → in the desktop app,
 *   the **Windows Credential Manager** through a narrow native command (Phase 8 final, CX-09) — encrypted
 *   for the Windows user, outside the web content's storage. Never `localStorage` in the desktop app: a
 *   token an older version left there is moved to the Credential Manager and deleted on first start.
 *   In a plain browser (development, end-to-end tests) there is no credential store, so `localStorage`.
 *
 * Only ever one token is stored. The token is never put in a URL, a log or an error message.
 */
const KEY = 'assessx.session-token'
const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let remembered: string | null = null
let loaded: Promise<void> | null = null

async function loadRemembered(): Promise<void> {
  if (!isDesktop) return
  try {
    const legacy = localStorage.getItem(KEY)
    if (legacy) {
      localStorage.removeItem(KEY)
      await invoke('session_token_store', { token: legacy })
    }
    remembered = (await invoke<string | null>('session_token_load')) ?? null
  } catch {
    remembered = null // no credential store: the user signs in again
  }
}

export const tokenStorage = {
  /** Reads a remembered token from the credential store once (call before the first `get` at startup). */
  load(): Promise<void> {
    loaded ??= loadRemembered()
    return loaded
  },
  get(): string | null {
    return sessionStorage.getItem(KEY) ?? (isDesktop ? remembered : localStorage.getItem(KEY))
  },
  set(token: string, remember: boolean): void {
    this.clear()
    if (!remember) {
      sessionStorage.setItem(KEY, token)
    } else if (isDesktop) {
      remembered = token
      void invoke('session_token_store', { token }).catch(() => {
        // The credential store refused: keep the sign-in for this window only.
        remembered = null
        sessionStorage.setItem(KEY, token)
      })
    } else {
      localStorage.setItem(KEY, token)
    }
  },
  clear(): void {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
    remembered = null
    if (isDesktop) void invoke('session_token_clear').catch(() => undefined)
  },
}
