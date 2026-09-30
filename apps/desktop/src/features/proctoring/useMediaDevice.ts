import { useCallback, useEffect, useRef, useState } from 'react'
import {
  classifyMediaError,
  constraintsFor,
  disconnectedCheck,
  unsupportedCheck,
  type DeviceCheck,
  type DeviceKind,
} from './devices'

export interface MediaDevice extends DeviceCheck {
  kind: DeviceKind
  /** The open stream while the device is `READY`; `null` otherwise. Local only — never uploaded. */
  stream: MediaStream | null
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
 */
export function useMediaDevice(kind: DeviceKind): MediaDevice {
  // The device is opened as soon as the owner mounts, so it starts out being checked.
  const [state, setState] = useState<DeviceCheck>({ status: 'CHECKING', message: null })
  const [stream, setStream] = useState<MediaStream | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const request = useRef(0)
  const pendingRelease = useRef<number | null>(null)

  const stopCurrent = useCallback(() => {
    const current = streamRef.current
    streamRef.current = null
    current?.getTracks().forEach((track) => {
      track.onended = null
      track.stop()
    })
  }, [])

  /** Requests the device. Every state change happens in the promise handlers, never synchronously. */
  const open = useCallback(
    (id: number) => {
      const pending = navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia(constraintsFor(kind))
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
          setState({ status: 'READY', message: null })
        },
        (error: unknown) => {
          if (id !== request.current) return
          setState(error === UNSUPPORTED ? unsupportedCheck(kind) : classifyMediaError(kind, error))
        },
      )
    },
    [kind, stopCurrent],
  )

  const check = useCallback(() => {
    stopCurrent()
    setStream(null)
    setState({ status: 'CHECKING', message: null })
    open(++request.current)
  }, [open, stopCurrent])

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

  // A device plugged in after being reported missing is picked up without a click. Only for the
  // "missing" case: a device that was blocked stays blocked until the candidate chooses to retry.
  const status = state.status
  useEffect(() => {
    const devices = navigator.mediaDevices
    if (!devices?.addEventListener || status !== 'UNAVAILABLE') return
    const onChange = () => check()
    devices.addEventListener('devicechange', onChange)
    return () => devices.removeEventListener('devicechange', onChange)
  }, [status, check])

  return { kind, ...state, stream, check }
}
