/**
 * Which in-page keyboard shortcuts a proctored exam blocks, and what each attempt is recorded as.
 *
 * These are the shortcuts the exam page itself receives and can cancel (`preventDefault`):
 * clipboard, printing, developer tools, browser navigation/tabs/search and function keys.
 * System-level shortcuts that never reach a page — Alt+Tab, the Windows key, Print Screen — are
 * the native guard's job (`src-tauri/src/lockdown/shortcuts.rs`), and Ctrl+Alt+Delete and Win+L
 * cannot be intercepted by any application at all.
 *
 * Names use the backend's shortcut vocabulary (upper-case parts joined by `+`).
 */

export type RestrictionEventType =
  | 'COPY_ATTEMPT'
  | 'CUT_ATTEMPT'
  | 'PASTE_ATTEMPT'
  | 'PRINT_ATTEMPT'
  | 'DEVTOOLS_ATTEMPT'
  | 'KEYBOARD_RESTRICTION_ATTEMPT'
  | 'SCREEN_CAPTURE_ATTEMPT'

export interface Restriction {
  eventType: RestrictionEventType
  shortcut: string
}

interface KeyLike {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** `KeyboardEvent.code` → the name used in the shortcut string. Letters and digits are derived. */
const NAMED_CODES: Record<string, string> = {
  Insert: 'INSERT',
  Delete: 'DELETE',
  Backspace: 'BACKSPACE',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  Tab: 'TAB',
  PrintScreen: 'PRINTSCREEN',
}

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-2])$/.test(code)) return code
  return NAMED_CODES[code] ?? null
}

export function shortcutName(event: KeyLike): string | null {
  const key = keyName(event.code)
  if (!key) return null
  return [event.ctrlKey && 'CTRL', event.shiftKey && 'SHIFT', event.altKey && 'ALT', key].filter(Boolean).join('+')
}

const COPY = new Set(['CTRL+C', 'CTRL+INSERT'])
const CUT = new Set(['CTRL+X', 'SHIFT+DELETE'])
const PASTE = new Set(['CTRL+V', 'CTRL+SHIFT+V', 'SHIFT+INSERT'])
const PRINT = new Set(['CTRL+P', 'CTRL+SHIFT+P'])
const DEVTOOLS = new Set(['F12', 'CTRL+SHIFT+I', 'CTRL+SHIFT+J', 'CTRL+SHIFT+C', 'CTRL+U'])
const NAVIGATION = new Set([
  // address bar, history, reload
  'CTRL+L',
  'ALT+LEFT',
  'ALT+RIGHT',
  'CTRL+R',
  'CTRL+SHIFT+R',
  'CTRL+F5',
  // tabs and windows
  'CTRL+T',
  'CTRL+N',
  'CTRL+SHIFT+N',
  'CTRL+W',
  'CTRL+SHIFT+W',
  'CTRL+SHIFT+T',
  'CTRL+TAB',
  'CTRL+SHIFT+TAB',
  ...Array.from({ length: 10 }, (_, digit) => `CTRL+${digit}`),
  // find, save, open
  'CTRL+F',
  'CTRL+G',
  'CTRL+SHIFT+G',
  'CTRL+S',
  'CTRL+O',
])

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}

/**
 * The restriction a key press falls under, or `null` when it is allowed.
 *
 * Plain typing, Tab/Shift+Tab focus movement, arrows, Space/Enter (answering) and Escape (closing a
 * dialog) are always allowed: the exam must stay fully usable from the keyboard.
 */
export function classifyKey(event: KeyLike, target: EventTarget | null = null): Restriction | null {
  const name = shortcutName(event)
  if (!name) return null
  if (COPY.has(name)) return { eventType: 'COPY_ATTEMPT', shortcut: name }
  if (CUT.has(name)) return { eventType: 'CUT_ATTEMPT', shortcut: name }
  if (PASTE.has(name)) return { eventType: 'PASTE_ATTEMPT', shortcut: name }
  if (PRINT.has(name)) return { eventType: 'PRINT_ATTEMPT', shortcut: name }
  if (DEVTOOLS.has(name)) return { eventType: 'DEVTOOLS_ATTEMPT', shortcut: name }
  if (name === 'PRINTSCREEN' || name.endsWith('+PRINTSCREEN')) return { eventType: 'SCREEN_CAPTURE_ATTEMPT', shortcut: name }
  if (NAVIGATION.has(name)) return { eventType: 'KEYBOARD_RESTRICTION_ATTEMPT', shortcut: name }
  // Every function key (F1 help, F3 find, F5 reload, F6 address bar, F7 caret browsing, F11 …).
  if (/^(CTRL\+|SHIFT\+|ALT\+)*F([1-9]|1[01])$/.test(name)) return { eventType: 'KEYBOARD_RESTRICTION_ATTEMPT', shortcut: name }
  // Backspace navigates back in some engines when nothing editable has focus.
  if (name === 'BACKSPACE' && !isEditable(target)) return { eventType: 'KEYBOARD_RESTRICTION_ATTEMPT', shortcut: name }
  return null
}
