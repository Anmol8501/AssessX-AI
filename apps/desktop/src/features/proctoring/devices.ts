/**
 * Camera and microphone availability, as the desktop app sees it (Phase 4A).
 *
 * This module only answers "can this device be opened, and if not, why?". It never inspects
 * what a camera shows or what a microphone hears: no frames or audio are read, stored or sent
 * anywhere. The server receives the resulting state (`toServerState`) and nothing else.
 *
 * The app runs in WebView2 (Tauri on Windows), so devices are opened with the standard
 * `navigator.mediaDevices.getUserMedia`; the permission prompt is WebView2's own, and a device
 * blocked in Windows privacy settings surfaces as `NotAllowedError` just like a refused prompt.
 */

import type { DeviceState } from '@/features/exam/types'

export type DeviceKind = 'camera' | 'microphone'

/**
 * What the app knows locally about one device. Richer than the server's `DeviceState` because the
 * candidate needs to know *what to do*: "blocked" and "in use by another app" need different fixes.
 */
export type LocalDeviceStatus = 'NOT_CHECKED' | 'CHECKING' | 'READY' | 'DENIED' | 'UNAVAILABLE' | 'ERROR'

export interface DeviceCheck {
  status: LocalDeviceStatus
  /** Candidate-facing explanation when the device is not ready. Never a raw browser error. */
  message: string | null
}

export const DEVICE_LABEL: Record<DeviceKind, string> = { camera: 'Camera', microphone: 'Microphone' }

export interface MediaDeviceInfoOption {
  deviceId: string
  label: string
  groupId?: string
}

const STORAGE_PREFIX = 'assessx_proctoring_selected_'

export function getPersistedDeviceId(kind: DeviceKind): string | null {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${kind}`)
  } catch {
    return null
  }
}

export function persistDeviceId(kind: DeviceKind, deviceId: string): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${kind}`, deviceId)
  } catch {
    // Ignore storage errors (private mode / restricted sandbox)
  }
}

export async function enumerateMediaDevices(kind: DeviceKind): Promise<MediaDeviceInfoOption[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return []
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const targetKind = kind === 'camera' ? 'videoinput' : 'audioinput'
    const matching = devices.filter((d) => d.kind === targetKind)
    return matching.map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || `${DEVICE_LABEL[kind]} ${index + 1}`,
      groupId: d.groupId,
    }))
  } catch {
    return []
  }
}

export type ProctoringReadinessState =
  | 'NOT_INITIALIZED'
  | 'CHECKING'
  | 'READY'
  | 'FAILED'
  | 'DEGRADED'

export function calculateOverallReadiness(
  cameraStatus: LocalDeviceStatus,
  micStatus: LocalDeviceStatus,
  policy?: { requireCamera?: boolean; requireMic?: boolean },
): ProctoringReadinessState {
  const reqCam = policy?.requireCamera ?? true
  const reqMic = policy?.requireMic ?? true

  if ((reqCam && cameraStatus === 'CHECKING') || (reqMic && micStatus === 'CHECKING')) {
    return 'CHECKING'
  }
  if ((reqCam && cameraStatus === 'NOT_CHECKED') || (reqMic && micStatus === 'NOT_CHECKED')) {
    return 'NOT_INITIALIZED'
  }

  const camOk = !reqCam || cameraStatus === 'READY'
  const micOk = !reqMic || micStatus === 'READY'

  if (camOk && micOk) {
    return 'READY'
  }

  const camDeniedOrUnavailable = cameraStatus === 'DENIED' || cameraStatus === 'UNAVAILABLE'
  const micDeniedOrUnavailable = micStatus === 'DENIED' || micStatus === 'UNAVAILABLE'

  if ((reqCam && camDeniedOrUnavailable) || (reqMic && micDeniedOrUnavailable)) {
    return 'FAILED'
  }

  return 'DEGRADED'
}

/** The only thing the server is told. `CHECKING`, `NOT_CHECKED` and `ERROR` are all "not ready". */
export function toServerState(status: LocalDeviceStatus): DeviceState {
  switch (status) {
    case 'READY':
      return 'READY'
    case 'DENIED':
      return 'DENIED'
    case 'UNAVAILABLE':
      return 'UNAVAILABLE'
    default:
      return 'NOT_READY'
  }
}

const MESSAGES: Record<DeviceKind, Record<'DENIED' | 'UNAVAILABLE' | 'DISCONNECTED' | 'ERROR' | 'UNSUPPORTED', string>> = {
  camera: {
    DENIED:
      'Camera access is blocked. Allow AssessX to use the camera (Windows Settings → Privacy & security → Camera), then retry.',
    UNAVAILABLE: 'No camera was found. Connect or enable a camera, then retry.',
    DISCONNECTED: 'Your camera was disconnected or stopped. Reconnect it, then retry.',
    ERROR: 'The camera could not be started. It may be in use by another application — close that application, then retry.',
    UNSUPPORTED: 'This device does not allow AssessX to use a camera.',
  },
  microphone: {
    DENIED:
      'Microphone access is blocked. Allow AssessX to use the microphone (Windows Settings → Privacy & security → Microphone), then retry.',
    UNAVAILABLE: 'No microphone was found. Connect or enable a microphone, then retry.',
    DISCONNECTED: 'Your microphone was disconnected or stopped. Reconnect it, then retry.',
    ERROR:
      'The microphone could not be started. It may be in use by another application — close that application, then retry.',
    UNSUPPORTED: 'This device does not allow AssessX to use a microphone.',
  },
}

export function disconnectedCheck(kind: DeviceKind): DeviceCheck {
  return { status: 'UNAVAILABLE', message: MESSAGES[kind].DISCONNECTED }
}

export function unsupportedCheck(kind: DeviceKind): DeviceCheck {
  return { status: 'UNAVAILABLE', message: MESSAGES[kind].UNSUPPORTED }
}

/**
 * Turns a `getUserMedia` failure into something a candidate can act on.
 *
 * The names are the standard `DOMException` names. Anything unrecognised is reported as a generic
 * failure rather than guessed at, and the raw error never reaches the screen.
 */
export function classifyMediaError(kind: DeviceKind, error: unknown): DeviceCheck {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return { status: 'DENIED', message: MESSAGES[kind].DENIED }
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { status: 'UNAVAILABLE', message: MESSAGES[kind].UNAVAILABLE }
    default:
      // NotReadableError / AbortError (device busy or failed to start), and anything unexpected.
      return { status: 'ERROR', message: MESSAGES[kind].ERROR }
  }
}

export function constraintsFor(kind: DeviceKind, deviceId?: string | null): MediaStreamConstraints {
  // 1280×720 where the camera offers it (was 640×360): the on-device object detector needs the
  // detail to see a small or distant phone. The live view to the administrator is still sent at
  // about 640 wide (see useMediaPublisher), and nothing is recorded.
  if (kind === 'camera') {
    return {
      video: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    }
  }
  return {
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    video: false,
  }
}
