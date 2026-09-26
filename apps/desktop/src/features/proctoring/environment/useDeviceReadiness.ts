import { useCallback, useEffect, useRef, useState } from 'react'
import { readinessBridge, type DetectedApp, type ReadinessBridge } from './readiness'
import type { EventMetadata } from './useEventReporter'

export type ReadinessStatus = 'unsupported' | 'scanning' | 'blocked' | 'closing' | 'ready'

/**
 * One entry of what the readiness check did, buffered so it can be written to the event log once
 * the proctoring session is active (the check runs before the attempt exists). Server timestamps
 * still win — these are reported through the normal event reporter.
 */
export interface ReadinessEvent {
  eventType: string
  metadata: EventMetadata
}

export interface DeviceReadiness {
  status: ReadinessStatus
  detected: DetectedApp[]
  /** Apps asked to close that were still open at the last recheck. */
  stubborn: DetectedApp[]
  busy: boolean
  rescan(): void
  closeAll(): void
  /** What the check observed, to report to the server after the session activates. */
  drainEvents(): ReadinessEvent[]
}

/**
 * The pre-exam device-readiness check (Phase 4B.5).
 *
 * It scans for prohibited applications that have a visible window, offers to close them gracefully
 * (never force-terminated — that is the native layer's guarantee), and rechecks. The exam cannot be
 * entered until the check is clean. Where other applications cannot be inspected — a plain browser —
 * the check reports `unsupported` and is skipped.
 *
 * Nothing is sent to the server here (there is no session yet). Each outcome is buffered and handed
 * to the caller through `drainEvents`, to be reported once the session is active.
 */
export function useDeviceReadiness(bridge: ReadinessBridge = readinessBridge()): DeviceReadiness {
  const [status, setStatus] = useState<ReadinessStatus>(bridge.supported ? 'scanning' : 'unsupported')
  const [detected, setDetected] = useState<DetectedApp[]>([])
  const [stubborn, setStubborn] = useState<DetectedApp[]>([])
  const [busy, setBusy] = useState(false)

  const events = useRef<ReadinessEvent[]>([])
  const reported = useRef<Set<string>>(new Set())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const record = useCallback((eventType: string, metadata: EventMetadata = {}) => {
    events.current.push({ eventType, metadata })
  }, [])

  const recordDetections = useCallback(
    (apps: DetectedApp[]) => {
      for (const app of apps) {
        if (reported.current.has(app.id)) continue
        reported.current.add(app.id)
        record('PROHIBITED_APP_DETECTED', { app: app.id, app_category: app.category })
      }
    },
    [record],
  )

  const scan = useCallback(async () => {
    if (!bridge.supported) return
    setBusy(true)
    setStatus((s) => (s === 'ready' || s === 'blocked' ? s : 'scanning'))
    try {
      const apps = await bridge.scan()
      if (!mounted.current) return
      recordDetections(apps)
      setDetected(apps)
      setStatus(apps.length === 0 ? 'ready' : 'blocked')
      if (apps.length === 0) record('DEVICE_CHECK_PASSED', { app_count: 0 })
    } catch {
      // A scan that cannot run is treated as "cannot verify": leave the current state, and the
      // candidate can retry. It never silently passes.
      if (mounted.current) setStatus((s) => (s === 'ready' ? s : 'blocked'))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [bridge, record, recordDetections])

  // First scan on mount (records DEVICE_CHECK_STARTED once).
  const started = useRef(false)
  useEffect(() => {
    if (!bridge.supported || started.current) return
    started.current = true
    record('DEVICE_CHECK_STARTED')
    void scan()
  }, [bridge.supported, record, scan])

  const closeAll = useCallback(async () => {
    if (detected.length === 0) return
    setBusy(true)
    setStatus('closing')
    const ids = detected.map((app) => app.id)
    for (const app of detected) record('APP_CLOSE_REQUESTED', { app: app.id })
    try {
      const remaining = await bridge.closeApps(ids)
      if (!mounted.current) return
      const remainingIds = new Set(remaining.map((app) => app.id))
      for (const app of detected) {
        record(remainingIds.has(app.id) ? 'APP_CLOSE_FAILED' : 'APP_CLOSED', { app: app.id })
      }
      recordDetections(remaining)
      setDetected(remaining)
      setStubborn(remaining)
      if (remaining.length === 0) {
        setStatus('ready')
        record('DEVICE_CHECK_PASSED', { app_count: 0 })
      } else {
        setStatus('blocked')
      }
    } catch {
      if (mounted.current) setStatus('blocked')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [bridge, detected, record, recordDetections])

  const drainEvents = useCallback(() => {
    const drained = events.current
    events.current = []
    return drained
  }, [])

  return {
    status,
    detected,
    stubborn,
    busy,
    rescan: () => void scan(),
    closeAll: () => void closeAll(),
    drainEvents,
  }
}
