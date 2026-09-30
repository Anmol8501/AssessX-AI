import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopBridge, securityMode, type CapabilityStatus, type DesktopBridge, type LockdownStatus, type WindowSnapshot } from './bridge'
import { classifyKey } from './restrictions'
import type { EventMetadata } from './useEventReporter'

/** How often the display configuration is re-read in the desktop app. */
const DISPLAY_POLL_MS = 5000
const NOTICE_MS = 4500

export interface Notice {
  id: number
  message: string
}

type Report = (eventType: string, metadata?: EventMetadata) => boolean

/** What the candidate is told. Plain and non-accusatory: an event is an observation, not a verdict. */
const NOTICE: Record<string, string> = {
  COPY_ATTEMPT: 'Copying is disabled during this assessment.',
  CUT_ATTEMPT: 'Cutting is disabled during this assessment.',
  PASTE_ATTEMPT: 'Pasting is disabled during this assessment.',
  CLIPBOARD_ACCESS_ATTEMPT: 'The clipboard is not available during this assessment.',
  CONTEXT_MENU_ATTEMPT: 'Right-click menus are disabled during this assessment.',
  PRINT_ATTEMPT: 'Printing is disabled during this assessment.',
  DEVTOOLS_ATTEMPT: 'Developer tools are disabled during this assessment.',
  KEYBOARD_RESTRICTION_ATTEMPT: 'That shortcut is disabled during this assessment.',
  SCREEN_CAPTURE_ATTEMPT: 'Screenshots are disabled during this assessment.',
  FOCUS_REGAINED: 'AssessX must remain the active application during the exam.',
  MULTIPLE_MONITORS_DETECTED: 'More than one display is connected. This has been noted for your exam.',
  REMOTE_SESSION_DETECTED: 'This exam is running in a remote desktop session. This has been noted for your exam.',
}

function capabilitiesOf(status: LockdownStatus, native: boolean): Record<string, CapabilityStatus> {
  return {
    fullscreen: status.fullscreen,
    focus_monitor: 'ACTIVE',
    keyboard_guard: 'ACTIVE',
    system_shortcut_guard: status.systemShortcutGuard,
    clipboard_guard: 'ACTIVE',
    context_menu_guard: 'ACTIVE',
    // The print dialog cannot be stopped from every route, but the exam is hidden from the page
    // that would be printed (print stylesheet), so what can be printed is a blank page.
    print_guard: 'BEST_EFFORT',
    capture_protection: status.captureProtection,
    always_on_top: status.alwaysOnTop,
    display_monitor: native ? 'ACTIVE' : 'UNAVAILABLE',
  }
}

/**
 * Exam environment enforcement for a proctored exam (Phase 4B). Active while the component using
 * it is mounted; everything is released when it unmounts (submission, timeout, leaving the exam).
 *
 *     detect ─► classify ─► record an event ─► (optionally) tell the candidate
 *
 * In-page restrictions (clipboard, context menu, print, developer tools, browser shortcuts) are
 * enforced here with `preventDefault`. System-level ones (fullscreen, always-on-top, capture
 * exclusion, Alt+Tab / Windows key / Print Screen) come from the native lockdown through `bridge`.
 * Nothing is scored or judged: a lost focus is recorded as a lost focus.
 *
 * Returns the notices to show and whether the candidate must return to fullscreen.
 */
export function useEnvironmentEnforcement(report: Report, bridge: DesktopBridge = desktopBridge()) {
  const [notices, setNotices] = useState<Notice[]>([])
  const [fullscreenRequired, setFullscreenRequired] = useState(false)
  const [fullscreenAvailable, setFullscreenAvailable] = useState(true)

  const reportRef = useRef(report)
  useEffect(() => {
    reportRef.current = report
  }, [report])

  const noticeId = useRef(0)
  const lastNotice = useRef<Map<string, number>>(new Map())
  const notify = useCallback((eventType: string) => {
    const message = NOTICE[eventType]
    if (!message) return
    const now = Date.now()
    if (now - (lastNotice.current.get(message) ?? 0) < 3000) return // not every repeat
    lastNotice.current.set(message, now)
    const id = ++noticeId.current
    setNotices((current) => [...current.slice(-2), { id, message }])
    window.setTimeout(() => setNotices((current) => current.filter((n) => n.id !== id)), NOTICE_MS)
  }, [])

  const emit = useCallback(
    (eventType: string, metadata: EventMetadata = {}, tell = true) => {
      reportRef.current(eventType, metadata)
      if (tell) notify(eventType)
    },
    [notify],
  )

  // Window state the transitions are measured against.
  const inFullscreen = useRef(false)
  const focusLostAt = useRef<number | null>(null)
  const displayCount = useRef(0)
  const everFullscreen = useRef(false)
  /** One automatic fullscreen restore per departure — never a loop of retries. */
  const autoRestoreArmed = useRef(false)
  const engaged = useRef(false)
  const pendingRelease = useRef<number | null>(null)

  const loseFocus = useCallback(
    (reason: 'deactivated' | 'minimized') => {
      if (focusLostAt.current !== null) return // one FOCUS_LOST per departure
      focusLostAt.current = Date.now()
      autoRestoreArmed.current = true
      emit('FOCUS_LOST', { reason }, false)
    },
    [emit],
  )

  const regainFocus = useCallback(() => {
    if (focusLostAt.current === null) return
    const duration = Date.now() - focusLostAt.current
    focusLostAt.current = null
    emit('FOCUS_REGAINED', { duration_ms: duration })
  }, [emit])

  const leaveFullscreen = useCallback(
    (reason: 'minimized' | 'resized' | 'user', minimized: boolean) => {
      if (!inFullscreen.current) return
      inFullscreen.current = false
      autoRestoreArmed.current = true
      setFullscreenRequired(true)
      emit(
        'FULLSCREEN_EXIT',
        { previous_state: 'fullscreen', current_state: minimized ? 'minimized' : 'windowed', reason },
        false,
      )
    },
    [emit],
  )

  const restoreFullscreen = useCallback(
    async (reason: 'user' | 'focus-regained') => {
      // Read before awaiting: entering fullscreen fires a window change that sets it.
      const entering = !everFullscreen.current
      const restored = await bridge.restoreFullscreen().catch(() => false)
      if (restored) {
        inFullscreen.current = true
        setFullscreenRequired(false)
        // The first time is entering, not restoring (a browser needs a click before it can).
        emit(entering ? 'FULLSCREEN_ENTER' : 'FULLSCREEN_RESTORED', { reason }, false)
        everFullscreen.current = true
      } else if (reason === 'user') {
        // Asked for and refused: stop insisting rather than trap the candidate behind the prompt.
        setFullscreenAvailable(false)
        setFullscreenRequired(false)
      }
      return restored
    },
    [bridge, emit],
  )

  const onWindowChange = useCallback(
    (snapshot: WindowSnapshot) => {
      if (snapshot.fullscreen) {
        if (!inFullscreen.current) {
          inFullscreen.current = true
          everFullscreen.current = true
          setFullscreenRequired(false)
        }
      } else {
        leaveFullscreen(snapshot.minimized ? 'minimized' : bridge.environment === 'browser' ? 'user' : 'resized', snapshot.minimized)
      }
      if (bridge.environment === 'desktop') {
        if (!snapshot.focused || snapshot.minimized) loseFocus(snapshot.minimized ? 'minimized' : 'deactivated')
        else {
          regainFocus() // no-op if the page's own focus event already recorded the return
          // Coming back is the one moment fullscreen is restored automatically — once per
          // departure, so a restore that does not take cannot turn into a loop.
          if (!snapshot.fullscreen && autoRestoreArmed.current) {
            autoRestoreArmed.current = false
            void restoreFullscreen('focus-regained')
          }
        }
      }
    },
    [bridge.environment, leaveFullscreen, loseFocus, regainFocus, restoreFullscreen],
  )

  // --- engage / release -----------------------------------------------------------------------
  useEffect(() => {
    if (pendingRelease.current !== null) {
      // Remounted immediately (React StrictMode in development): keep the lockdown already engaged.
      window.clearTimeout(pendingRelease.current)
      pendingRelease.current = null
    } else {
      engaged.current = true
      void bridge
        .engage()
        .then(async (status) => {
          if (!engaged.current) return // released before the native side answered
          const native = bridge.environment === 'desktop'
          const mode = await securityMode()
          if (!engaged.current) return
          emit(
            'ENFORCEMENT_STATUS',
            { capabilities: capabilitiesOf(status, native), environment: bridge.environment, security_mode: mode },
            false,
          )
          setFullscreenAvailable(status.fullscreen === 'ACTIVE' || !native)
          if (status.fullscreen === 'ACTIVE') {
            inFullscreen.current = true
            everFullscreen.current = true
            emit('FULLSCREEN_ENTER', { reason: 'exam-start' }, false)
          } else if (!native) {
            setFullscreenRequired(true) // a browser needs a click to go fullscreen: offer the button
          }
          displayCount.current = status.displayCount
          if (status.displayCount > 1) emit('MULTIPLE_MONITORS_DETECTED', { display_count: status.displayCount })
          if (status.remoteSession) emit('REMOTE_SESSION_DETECTED')
        })
        .catch(() => {
          if (!engaged.current) return
          // The native lockdown could not be engaged at all: record that rather than pretend.
          setFullscreenAvailable(false)
          emit(
            'ENFORCEMENT_STATUS',
            {
              capabilities: { fullscreen: 'UNAVAILABLE', system_shortcut_guard: 'UNAVAILABLE', capture_protection: 'UNAVAILABLE' },
              environment: bridge.environment,
            },
            false,
          )
        })
    }
    return () => {
      // Released a tick later, so an immediate remount can cancel it (see above).
      pendingRelease.current = window.setTimeout(() => {
        pendingRelease.current = null
        engaged.current = false
        void bridge.release().catch(() => undefined)
      }, 0)
    }
  }, [bridge, emit])

  // --- native notifications ------------------------------------------------------------------
  useEffect(() => {
    let disposed = false
    const unlisten: Array<() => void> = []
    void bridge
      .onShortcut(({ eventType, shortcut }) => emit(eventType, { shortcut, blocked: true, channel: 'native-hook' }))
      .then((off) => (disposed ? off() : unlisten.push(off)))
    void bridge.onWindowChange(onWindowChange).then((off) => (disposed ? off() : unlisten.push(off)))
    return () => {
      disposed = true
      unlisten.forEach((off) => off())
    }
  }, [bridge, emit, onWindowChange])

  // --- display configuration (desktop only) ------------------------------------------------------
  useEffect(() => {
    if (bridge.environment !== 'desktop') return
    const timer = window.setInterval(() => {
      void bridge
        .snapshot()
        .then((snapshot) => {
          const previous = displayCount.current
          if (previous === 0 || snapshot.displayCount === 0 || snapshot.displayCount === previous) return
          displayCount.current = snapshot.displayCount
          emit('DISPLAY_CONFIGURATION_CHANGED', { display_count: snapshot.displayCount, previous_display_count: previous }, false)
          if (snapshot.displayCount > 1 && previous <= 1) emit('MULTIPLE_MONITORS_DETECTED', { display_count: snapshot.displayCount })
        })
        .catch(() => undefined)
    }, DISPLAY_POLL_MS)
    return () => window.clearInterval(timer)
  }, [bridge, emit])

  // --- in-page restrictions ------------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const restriction = classifyKey(event, event.target)
      if (!restriction) return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return // holding the key is one attempt
      emit(restriction.eventType, { shortcut: restriction.shortcut, blocked: true, channel: 'keyboard' })
    }
    // Windows delivers only the key-up of Print Screen to a page. It cannot be cancelled from here;
    // in the desktop app the native guard swallows it first, so this fires only in a browser.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'PrintScreen') emit('SCREEN_CAPTURE_ATTEMPT', { shortcut: 'PRINTSCREEN', blocked: false, channel: 'keyboard' })
    }
    const onClipboard = (type: 'COPY_ATTEMPT' | 'CUT_ATTEMPT' | 'PASTE_ATTEMPT') => (event: ClipboardEvent) => {
      event.preventDefault() // nothing is read from or written to the clipboard
      emit(type, { blocked: true, channel: 'clipboard-event' })
    }
    const onCopy = onClipboard('COPY_ATTEMPT')
    const onCut = onClipboard('CUT_ATTEMPT')
    const onPaste = onClipboard('PASTE_ATTEMPT')
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      emit('CONTEXT_MENU_ATTEMPT', { blocked: true, channel: 'pointer' })
    }
    const onDragStart = (event: DragEvent) => event.preventDefault()
    const onBeforePrint = () => emit('PRINT_ATTEMPT', { blocked: true, channel: 'print-event' })
    const onBlur = () => loseFocus('deactivated')
    const onFocus = () => {
      if (focusLostAt.current !== null) regainFocus()
    }
    // No `visibilitychange`: leaving the window already fires `blur`, minimizing is reported by the
    // native window events, and a page unload (the app restarting) would otherwise read as a
    // departure that never happened.

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    document.addEventListener('copy', onCopy, true)
    document.addEventListener('cut', onCut, true)
    document.addEventListener('paste', onPaste, true)
    document.addEventListener('contextmenu', onContextMenu, true)
    document.addEventListener('dragstart', onDragStart, true)
    window.addEventListener('beforeprint', onBeforePrint)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    // Hides the exam from selection and from anything printed (see index.css).
    document.body.classList.add('exam-lockdown')

    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      document.removeEventListener('copy', onCopy, true)
      document.removeEventListener('cut', onCut, true)
      document.removeEventListener('paste', onPaste, true)
      document.removeEventListener('contextmenu', onContextMenu, true)
      document.removeEventListener('dragstart', onDragStart, true)
      window.removeEventListener('beforeprint', onBeforePrint)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      document.body.classList.remove('exam-lockdown')
    }
  }, [emit, loseFocus, regainFocus])

  return {
    notices,
    fullscreenRequired,
    fullscreenAvailable,
    returnToFullscreen: () => restoreFullscreen('user'),
    environment: bridge.environment,
  }
}
