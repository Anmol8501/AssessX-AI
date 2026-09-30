/**
 * Neutral, factual labels for proctoring events shown in the candidate detail view (Phase 4C).
 *
 * The words describe what the software observed, nothing more. There is no "cheating",
 * "suspicious" or "risk" language anywhere — interpretation is not part of Phase 4C.
 */

import type { MonitoringEvent } from './types'

const LABELS: Record<string, string> = {
  SESSION_STARTED: 'Proctoring started',
  SESSION_RESUMED: 'Proctoring resumed',
  SESSION_ENDED: 'Proctoring ended',
  CAMERA_DISCONNECTED: 'Camera disconnected',
  CAMERA_RECONNECTED: 'Camera reconnected',
  MIC_DISCONNECTED: 'Microphone disconnected',
  MIC_RECONNECTED: 'Microphone reconnected',
  FULLSCREEN_ENTER: 'Fullscreen entered',
  FULLSCREEN_EXIT: 'Fullscreen exited',
  FULLSCREEN_RESTORED: 'Fullscreen restored',
  FOCUS_LOST: 'Focus lost',
  FOCUS_REGAINED: 'Focus regained',
  COPY_ATTEMPT: 'Copy blocked',
  CUT_ATTEMPT: 'Cut blocked',
  PASTE_ATTEMPT: 'Paste blocked',
  CLIPBOARD_ACCESS_ATTEMPT: 'Clipboard access blocked',
  CONTEXT_MENU_ATTEMPT: 'Right-click blocked',
  PRINT_ATTEMPT: 'Print blocked',
  DEVTOOLS_ATTEMPT: 'Developer tools blocked',
  KEYBOARD_RESTRICTION_ATTEMPT: 'Restricted shortcut blocked',
  SCREEN_CAPTURE_ATTEMPT: 'Screenshot attempt',
  MULTIPLE_MONITORS_DETECTED: 'Multiple monitors detected',
  DISPLAY_CONFIGURATION_CHANGED: 'Display configuration changed',
  REMOTE_SESSION_DETECTED: 'Remote desktop session detected',
  ENFORCEMENT_STATUS: 'Environment enforcement status',
  DEVICE_CHECK_STARTED: 'Device check started',
  PROHIBITED_APP_DETECTED: 'Prohibited application detected',
  APP_CLOSE_REQUESTED: 'Application close requested',
  APP_CLOSED: 'Application closed',
  APP_CLOSE_FAILED: 'Application did not close',
  DEVICE_CHECK_PASSED: 'Device check passed',
  DEVICE_CHECK_FAILED: 'Device check failed',
}

export function eventLabel(event: MonitoringEvent): string {
  const base = LABELS[event.eventType] ?? event.eventType.replaceAll('_', ' ').toLowerCase()
  // A couple of events read better with their one factual detail appended.
  const meta = event.metadata
  if (event.eventType === 'PROHIBITED_APP_DETECTED' && typeof meta.app === 'string') return `${base}: ${meta.app}`
  if (typeof meta.shortcut === 'string') return `${base} (${meta.shortcut})`
  if (event.eventType === 'MULTIPLE_MONITORS_DETECTED' && typeof meta.display_count === 'number') {
    return `${base} (${meta.display_count})`
  }
  return base
}
