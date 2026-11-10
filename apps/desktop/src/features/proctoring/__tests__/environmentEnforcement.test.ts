import { describe, expect, it } from 'vitest'
import {
  classifyKey,
} from '../environment/restrictions'
import type { LockdownStatus, WindowSnapshot } from '../environment/bridge'

describe('Phase 4B: Exam Environment Enforcement & Event Reporting', () => {
  describe('Keyboard restrictions & shortcut classification', () => {
    it('classifies developer tools shortcut F12 as DEVTOOLS_ATTEMPT', () => {
      const event = { key: 'F12', code: 'F12', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }
      const res = classifyKey(event)
      expect(res).not.toBeNull()
      expect(res?.eventType).toBe('DEVTOOLS_ATTEMPT')
      expect(res?.shortcut).toBe('F12')
    })

    it('classifies print shortcut Ctrl+P as PRINT_ATTEMPT', () => {
      const event = { key: 'p', code: 'KeyP', ctrlKey: true, altKey: false, metaKey: false, shiftKey: false }
      const res = classifyKey(event)
      expect(res).not.toBeNull()
      expect(res?.eventType).toBe('PRINT_ATTEMPT')
      expect(res?.shortcut).toBe('CTRL+P')
    })

    it('classifies screenshot shortcut PrintScreen as SCREEN_CAPTURE_ATTEMPT', () => {
      const event = { key: 'PrintScreen', code: 'PrintScreen', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }
      const res = classifyKey(event)
      expect(res).not.toBeNull()
      expect(res?.eventType).toBe('SCREEN_CAPTURE_ATTEMPT')
      expect(res?.shortcut).toBe('PRINTSCREEN')
    })

    it('classifies copy/cut/paste shortcuts', () => {
      const copy = { key: 'c', code: 'KeyC', ctrlKey: true, altKey: false, metaKey: false, shiftKey: false }
      expect(classifyKey(copy)?.eventType).toBe('COPY_ATTEMPT')

      const cut = { key: 'x', code: 'KeyX', ctrlKey: true, altKey: false, metaKey: false, shiftKey: false }
      expect(classifyKey(cut)?.eventType).toBe('CUT_ATTEMPT')

      const paste = { key: 'v', code: 'KeyV', ctrlKey: true, altKey: false, metaKey: false, shiftKey: false }
      expect(classifyKey(paste)?.eventType).toBe('PASTE_ATTEMPT')
    })

    it('allows normal typing keys and basic navigation (returns null)', () => {
      const aKey = { key: 'a', code: 'KeyA', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }
      expect(classifyKey(aKey)).toBeNull()

      const enterKey = { key: 'Enter', code: 'Enter', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }
      expect(classifyKey(enterKey)).toBeNull()

      const arrowKey = { key: 'ArrowDown', code: 'ArrowDown', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }
      expect(classifyKey(arrowKey)).toBeNull()
    })
  })

  describe('Window & Environment snapshot modeling', () => {
    it('models clean examination lockdown snapshot', () => {
      const snapshot: WindowSnapshot = {
        fullscreen: true,
        minimized: false,
        focused: true,
        displayCount: 1,
        remoteSession: false,
        leftTo: null,
      }
      expect(snapshot.fullscreen).toBe(true)
      expect(snapshot.minimized).toBe(false)
      expect(snapshot.focused).toBe(true)
      expect(snapshot.leftTo).toBeNull()
    })

    it('models focus departure with destination tracking', () => {
      const departureSnapshot: WindowSnapshot = {
        fullscreen: false,
        minimized: false,
        focused: false,
        displayCount: 1,
        remoteSession: false,
        leftTo: 'app',
      }
      expect(departureSnapshot.focused).toBe(false)
      expect(departureSnapshot.leftTo).toBe('app')
    })

    it('models lockdown capability status correctly', () => {
      const status: LockdownStatus = {
        fullscreen: 'ACTIVE',
        alwaysOnTop: 'ACTIVE',
        captureProtection: 'ACTIVE',
        systemShortcutGuard: 'ACTIVE',
        displayCount: 1,
        remoteSession: false,
      }
      expect(status.fullscreen).toBe('ACTIVE')
      expect(status.systemShortcutGuard).toBe('ACTIVE')
      expect(status.remoteSession).toBe(false)
    })
  })

  describe('Event deduping and normalization rules', () => {
    it('folds identical events occurring within duplicate window', () => {
      const events: Array<{ type: string; meta: Record<string, string>; time: number }> = []
      const dedupeWindow = 1500
      let lastTime = 0
      let lastKey = ''

      function mockReport(type: string, meta: Record<string, string>, time: number) {
        const key = `${type}:${JSON.stringify(meta)}`
        if (key === lastKey && time - lastTime < dedupeWindow) {
          return false
        }
        lastKey = key
        lastTime = time
        events.push({ type, meta, time })
        return true
      }

      const t0 = 1000
      expect(mockReport('PASTE_ATTEMPT', { channel: 'keyboard' }, t0)).toBe(true)
      expect(mockReport('PASTE_ATTEMPT', { channel: 'keyboard' }, t0 + 200)).toBe(false)
      expect(mockReport('PASTE_ATTEMPT', { channel: 'keyboard' }, t0 + 500)).toBe(false)
      expect(mockReport('PASTE_ATTEMPT', { channel: 'keyboard' }, t0 + 1600)).toBe(true)
      expect(events.length).toBe(2)
    })

    it('deduplicates candidate warning notifications within warning threshold', () => {
      const activeNotices: string[] = []
      const lastNoticeTime = new Map<string, number>()
      const NOTICE_MS = 3000

      function notify(msg: string, now: number) {
        const last = lastNoticeTime.get(msg)
        if (last !== undefined && now - last < NOTICE_MS) return false
        lastNoticeTime.set(msg, now)
        activeNotices.push(msg)
        return true
      }

      const warningText = 'You have exited fullscreen mode. Please return to the examination window.'
      expect(notify(warningText, 1000)).toBe(true)
      expect(notify(warningText, 1500)).toBe(false)
      expect(notify(warningText, 2999)).toBe(false)
      expect(notify(warningText, 4001)).toBe(true)
      expect(activeNotices.length).toBe(2)
    })

    it('tracks recovery lifecycle states sequentially', () => {
      const lifecycle: string[] = []
      function recordLifecycle(state: 'STARTED' | 'SUCCEEDED' | 'FAILED') {
        lifecycle.push(`ENVIRONMENT_RECOVERY_${state}`)
      }

      recordLifecycle('STARTED')
      recordLifecycle('SUCCEEDED')

      expect(lifecycle).toEqual([
        'ENVIRONMENT_RECOVERY_STARTED',
        'ENVIRONMENT_RECOVERY_SUCCEEDED',
      ])
    })
  })
})
