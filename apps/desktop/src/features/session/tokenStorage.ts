/**
 * Where the bearer token lives between requests.
 *
 * "Keep me signed in" → localStorage (survives relaunch); otherwise sessionStorage (cleared
 * when the window closes). Only ever one token is stored. Moving this into the OS credential
 * store via a Tauri plugin is a Phase 9 hardening item; the interface here does not change.
 */
const KEY = 'assessx.session-token'

export const tokenStorage = {
  get(): string | null {
    return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY)
  },
  set(token: string, remember: boolean): void {
    this.clear()
    ;(remember ? localStorage : sessionStorage).setItem(KEY, token)
  },
  clear(): void {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
  },
}
