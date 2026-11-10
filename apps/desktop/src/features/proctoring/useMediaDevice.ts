import { useCallback, useEffect, useRef, useState } from 'react'
import {
  classifyMediaError,
  constraintsFor,
  disconnectedCheck,
  enumerateMediaDevices,
  getPersistedDeviceId,
  persistDeviceId,
  unsupportedCheck,
  type DeviceCheck,
  type DeviceKind,
  type MediaDeviceInfoOption,
} from './devices'

export interface MediaDevice extends DeviceCheck {
  kind: DeviceKind
  /** The open stream while the device is `READY`; `null` otherwise. Local only — never uploaded. */
  stream: MediaStream | null
  /** Available devices discovered through enumeration. */
  availableDevices: MediaDeviceInfoOption[]
  /** Currently active device ID. */
  selectedDeviceId: string | null
  /** Human-readable device name/label. */
  selectedLabel: string | null
  /** Switches to a specific device. */
  selectDevice(deviceId: string): void
  /** Opens (or re-opens) the device. Safe to call repeatedly; only the latest call wins. */
  check(): void
}

/** Raised in place of calling `getUserMedia` when the platform does not offer it at all. */
const UNSUPPORTED = Symbol('media-unsupported')

/**
 * Owns one camera or microphone stream for as long as the component using it is mounted.
 *
 * * **Released on unmount.** Every track is stopped when the owner goes away — leaving the
 *   readiness screen, finishing the exam, signing out — so the device's light goes off and no
 *   stream outlives the proctored exam.
 * * **Disconnection is noticed.** A track that ends (device unplugged, driver stopped, access
 *   revoked) moves the device to `UNAVAILABLE`; plugging a device back in re-checks automatically.
 * * **Stale requests are discarded.** A slow permission prompt that resolves after a retry, or
 *   after the component unmounted, has its stream stopped immediately instead of leaking.
 * * **One request per device at a time.** Release is deferred by a tick, so an immediate remount
 *   (React StrictMode does this in development) keeps the request already in flight rather than
 *   stopping it and opening the same device again. Stopping a device while a second request for it
 *   is pending can leave Chromium's capture stack handing back an already-ended track.
 * * **Device Selection & Enumeration.** Discovers available hardware, remembers chosen devices,
 *   and provides readable hardware labels for proctoring audit trails.
 */
export function useMediaDevice(kind: DeviceKind): MediaDevice {
  // The device is opened as soon as the owner mounts, so it starts out being checked.
  const [state, setState] = useState<DeviceCheck>({ status: 'CHECKING', message: null })
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [availableDevices, setAvailableDevices] = useState<MediaDeviceInfoOption[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(() => getPersistedDeviceId(kind))
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const request = useRef(0)
  const pendingRelease = useRef<number | null>(null)
  const selectedDeviceRef = useRef<string | null>(selectedDeviceId)
  useEffect(() => {
    selectedDeviceRef.current = selectedDeviceId
  }, [selectedDeviceId])

  const stopCurrent = useCallback(() => {
    const current = streamRef.current
    streamRef.current = null
    current?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
  }, [])

  const refreshDeviceList = useCallback(async () => {
    const list = await enumerateMediaDevices(kind)
    setAvailableDevices(list)
    return list
  }, [kind])

  /** Requests the device. Every state change happens in the promise handlers, never synchronously. */
  const open = useCallback(
    (id: number, targetDeviceId?: string | null) => {
      const devId = targetDeviceId !== undefined ? targetDeviceId : selectedDeviceRef.current
      const pending = navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia(constraintsFor(kind, devId))
        : Promise.reject(UNSUPPORTED)

      pending.then(
        (opened) => {
          if (id !== request.current) {
            opened.getTracks().forEach((track) => track.stop()) // superseded or released
            return
          }
          const [track] = kind === 'camera' ? opened.getVideoTracks() : opened.getAudioTracks()
          if (!track) {
            opened.getTracks().forEach((t) => t.stop())
            setState(classifyMediaError(kind, new DOMException('No track', 'NotFoundError')))
            return
          }
          if (track.readyState === 'ended') {
            // Opened, but the device went away before the stream arrived.
            opened.getTracks().forEach((t) => t.stop())
            setState(disconnectedCheck(kind))
            return
          }
          track.onended = () => {
            if (streamRef.current !== opened) return
            stopCurrent()
            setStream(null)
            setState(disconnectedCheck(kind))
          }
          streamRef.current = opened
          setStream(opened)

          const settings = track.getSettings()
          const resolvedId = settings.deviceId || devId || null
          const resolvedLabel = track.label || null
          if (resolvedId) {
            setSelectedDeviceId(resolvedId)
            persistDeviceId(kind, resolvedId)
          }
          setSelectedLabel(resolvedLabel)
          setState({ status: 'READY', message: null })

          // Enumerate to get readable labels after permission grant
          void refreshDeviceList()
        },
        (error: unknown) => {
          if (id !== request.current) return
          setState(error === UNSUPPORTED ? unsupportedCheck(kind) : classifyMediaError(kind, error))
        },
      )
    },
    [kind, stopCurrent, refreshDeviceList],
  )

  const check = useCallback(() => {
    stopCurrent()
    setStream(null)
    setState({ status: 'CHECKING', message: null })
    open(++request.current)
  }, [open, stopCurrent])

  const selectDevice = useCallback(
    (deviceId: string) => {
      stopCurrent()
      setStream(null)
      setSelectedDeviceId(deviceId)
      persistDeviceId(kind, deviceId)
      setState({ status: 'CHECKING', message: null })
      open(++request.current, deviceId)
    },
    [kind, open, stopCurrent],
  )

  useEffect(() => {
    if (pendingRelease.current !== null) {
      // Remounted straight away: keep the stream (or the request) this hook already holds.
      window.clearTimeout(pendingRelease.current)
      pendingRelease.current = null
    } else {
      open(++request.current)
    }
    const requests = request // the counter itself, not a DOM node: read at release time on purpose
    return () => {
      pendingRelease.current = window.setTimeout(() => {
        pendingRelease.current = null
        requests.current++ // a request still pending is stopped when it arrives
        stopCurrent()
      }, 0)
    }
  }, [open, stopCurrent])

  // Listen for hardware changes (device plugged in or unplugged)
  useEffect(() => {
    const devices = navigator.mediaDevices
    if (!devices?.addEventListener) return
    const onChange = async () => {
      const list = await refreshDeviceList()
      // If a missing device is now connected or active device disconnected
      if (state.status === 'UNAVAILABLE') {
        check()
      } else if (state.status === 'READY' && selectedDeviceId) {
        const stillPresent = list.some((d) => d.deviceId === selectedDeviceId)
        if (!stillPresent && list.length > 0) {
          // Fall back to first available or recheck
          check()
        }
      }
    }
    devices.addEventListener('devicechange', onChange)
    return () => devices.removeEventListener('devicechange', onChange)
  }, [state.status, selectedDeviceId, refreshDeviceList, check])

  return {
    kind,
    ...state,
    stream,
    availableDevices,
    selectedDeviceId,
    selectedLabel,
    selectDevice,
    check,
  }
}
