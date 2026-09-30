import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '@/features/session'
import { tokenStorage } from '@/features/session'
import { API_BASE_URL } from '@/lib/api'
import type { ConnectionState } from './status'
import { toSession, type MonitoringSession, type MonitoringSummary } from './types'

const RECONNECT_MAX_MS = 8000

type Loadable = 'loading' | 'error' | 'ready'

/** A signaling message routed to/from one candidate by attempt id (WebRTC over the monitoring WS). */
export interface Signal {
  type: string
  attempt_id: string
  [key: string]: unknown
}

export interface MonitoringSignaling {
  /** Send an admin→candidate signaling message (WATCH/UNWATCH/ANSWER/ICE). No-op if disconnected. */
  send(message: Signal): void
  /** Receive signaling for one attempt. Returns an unsubscribe. */
  subscribe(attemptId: string, handler: (message: Signal) => void): () => void
}

export interface Monitoring {
  status: Loadable
  error: string | null
  sessions: MonitoringSession[]
  summary: MonitoringSummary
  connection: ConnectionState
  reload(): void
  signaling: MonitoringSignaling
}

function wsUrl(token: string): string {
  const base = API_BASE_URL.replace(/^http/, 'ws')
  return `${base}/api/v1/ws/admin/monitoring?token=${encodeURIComponent(token)}`
}

function summarise(sessions: MonitoringSession[]): MonitoringSummary {
  return {
    activeSessions: sessions.length,
    camerasReady: sessions.filter((s) => s.cameraState === 'READY').length,
    cameraIssues: sessions.filter((s) => s.cameraState !== 'READY').length,
    microphoneIssues: sessions.filter((s) => s.microphoneState !== 'READY').length,
  }
}

/**
 * The live monitoring wall's data: the initial set of active sessions from REST, then live deltas
 * over one WebSocket, with bounded-backoff reconnect and reconcile (the database stays
 * authoritative — a refetch after reconnect fixes anything missed while disconnected).
 *
 * The same WebSocket carries WebRTC signaling; `signaling` lets each tile's viewer exchange
 * offer/answer/ICE with its candidate, routed by attempt id.
 */
export function useMonitoring(): Monitoring {
  const api = useApi()
  const [status, setStatus] = useState<Loadable>('loading')
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Map<string, MonitoringSession>>(new Map())
  const [connection, setConnection] = useState<ConnectionState>('reconnecting')

  const socket = useRef<WebSocket | null>(null)
  const connectRef = useRef<() => void>(() => undefined)
  const retry = useRef(500)
  const retryTimer = useRef<number | null>(null)
  const closed = useRef(false)
  const handlers = useRef<Map<string, Set<(m: Signal) => void>>>(new Map())

  const fetchActive = useCallback(async () => {
    const raw = await api<{ summary: unknown; sessions: Record<string, unknown>[] }>('/api/v1/admin/monitoring/sessions')
    const list = raw.sessions.map(toSession)
    setSessions(new Map(list.map((s) => [s.attemptId, s])))
    setStatus('ready')
    setError(null)
  }, [api])

  const dispatchSignal = useCallback((message: Signal) => {
    const subs = handlers.current.get(message.attempt_id)
    if (subs) for (const h of subs) h(message)
  }, [])

  const onMessage = useCallback(
    (raw: MessageEvent) => {
      let message: { type?: string; attempt_id?: string; session?: Record<string, unknown> }
      try {
        message = JSON.parse(raw.data as string)
      } catch {
        return
      }
      switch (message.type) {
        case 'SESSION_ADDED':
        case 'SESSION_UPDATED':
          if (message.session) {
            const session = toSession(message.session)
            setSessions((prev) => new Map(prev).set(session.attemptId, session))
          }
          break
        case 'SESSION_REMOVED':
          if (message.attempt_id) {
            setSessions((prev) => {
              const next = new Map(prev)
              next.delete(message.attempt_id!)
              return next
            })
          }
          break
        case 'WEBRTC_OFFER':
        case 'WEBRTC_ANSWER':
        case 'ICE_CANDIDATE':
        case 'PUBLISH_STATE':
        case 'PROCTORING_EVENT':
          if (message.attempt_id) dispatchSignal(message as Signal)
          break
        default:
          break
      }
    },
    [dispatchSignal],
  )

  const connect = useCallback(() => {
    const token = tokenStorage.get()
    if (!token || closed.current) return
    setConnection((c) => (c === 'connected' ? 'reconnecting' : c))
    const ws = new WebSocket(wsUrl(token))
    socket.current = ws

    ws.onopen = () => {
      retry.current = 500
      setConnection('connected')
      // Reconcile: the socket may have missed changes while it was down.
      void fetchActive().catch(() => undefined)
    }
    ws.onmessage = onMessage
    ws.onclose = () => {
      if (socket.current === ws) socket.current = null
      if (closed.current) return
      setConnection('disconnected')
      retryTimer.current = window.setTimeout(() => connectRef.current(), retry.current)
      retry.current = Math.min(retry.current * 2, RECONNECT_MAX_MS)
    }
    ws.onerror = () => ws.close()
  }, [fetchActive, onMessage])
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    closed.current = false
    void fetchActive().catch((caught: unknown) => {
      setStatus('error')
      setError(caught instanceof Error ? caught.message : 'Unable to load live monitoring sessions.')
    })
    connect()
    return () => {
      closed.current = true
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current)
      socket.current?.close()
      socket.current = null
    }
  }, [connect, fetchActive])

  const reload = useCallback(() => {
    setStatus('loading')
    void fetchActive().catch((caught: unknown) => {
      setStatus('error')
      setError(caught instanceof Error ? caught.message : 'Unable to load live monitoring sessions.')
    })
  }, [fetchActive])

  const signaling: MonitoringSignaling = {
    send: useCallback((message: Signal) => {
      const ws = socket.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
    }, []),
    subscribe: useCallback((attemptId: string, handler: (m: Signal) => void) => {
      const set = handlers.current.get(attemptId) ?? new Set()
      set.add(handler)
      handlers.current.set(attemptId, set)
      return () => {
        set.delete(handler)
        if (set.size === 0) handlers.current.delete(attemptId)
      }
    }, []),
  }

  const list = [...sessions.values()]
  return { status, error, sessions: list, summary: summarise(list), connection, reload, signaling }
}
