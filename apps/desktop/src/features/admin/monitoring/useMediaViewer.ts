import { useEffect, useRef, useState } from 'react'
import { loadIceServers, type MediaState } from './webrtc'
import type { MonitoringSignaling, Signal } from './useMonitoring'

interface Viewer {
  state: MediaState
  stream: MediaStream | null
}

/** A failed or long-interrupted video connection is renegotiated this many times before giving up. */
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2500
/** A connection that stays "disconnected" this long is treated as failed and renegotiated. */
const DISCONNECTED_GRACE_MS = 6000
/** ICE candidates held for an offer that has not arrived yet (bounded). */
const MAX_PENDING_ICE = 200

/**
 * The admin's live-video viewer for one candidate (Phase 4C).
 *
 * It watches a candidate's media by signaling over the monitoring WebSocket: it asks to WATCH, the
 * candidate publishes an offer, this side answers, and ICE is exchanged. Media then flows
 * peer-to-peer over WebRTC (relayed by TURN when the server provides it and a direct path is
 * impossible) — never through the WebSocket or REST. When `enabled` is false (the view is closed, or
 * the monitoring connection is down) it reports an honest state rather than fake video, and it tears
 * the peer connection down; when the monitoring connection returns, `enabled` flips back and the
 * WATCH is sent again, so video resumes on its own.
 *
 * Each offer carries an `offer_id`; the answer and this side's ICE candidates echo it, and candidate
 * ICE for any other id is ignored. A newer offer (a retry, the candidate app reconnecting) replaces
 * the connection, so an answer can never be applied to the wrong negotiation.
 *
 * A connection that fails, or stays disconnected, is renegotiated automatically a few times (a new
 * WATCH makes the candidate send a fresh offer) before the viewer reports "failed".
 *
 * Everything is cleaned up on unmount or when disabled: the WATCH is released, the peer connection
 * is closed and remote tracks stopped, so no connection or stream leaks.
 */
export function useMediaViewer(attemptId: string, enabled: boolean, signaling: MonitoringSignaling): Viewer {
  const [state, setState] = useState<MediaState>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)

  // Keep the latest signaling.send without re-subscribing the whole effect on every render.
  const send = useRef(signaling.send)
  useEffect(() => {
    send.current = signaling.send
  }, [signaling.send])

  useEffect(() => {
    if (!enabled) {
      setState('idle')
      return
    }
    let disposed = false
    let retries = 0
    let retryTimer: number | null = null
    let graceTimer: number | null = null
    let pc: RTCPeerConnection | null = null
    let offerId: string | null = null
    let pendingIce: { offerId: string; ice: RTCIceCandidateInit }[] = []
    setState('connecting')
    // Fetch STUN/TURN before the candidate's offer arrives, so answering is not delayed.
    const iceServers = loadIceServers()

    const clearTimers = () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      if (graceTimer !== null) window.clearTimeout(graceTimer)
      retryTimer = graceTimer = null
    }

    const close = () => {
      pc?.getReceivers().forEach((r) => r.track?.stop())
      pc?.close()
      pc = null
      offerId = null
      setStream(null)
    }

    /** Tears the connection down and asks the candidate for a fresh offer, a few times at most. */
    const renegotiate = () => {
      if (disposed) return
      clearTimers()
      close()
      if (retries >= MAX_RETRIES) {
        setState('failed')
        return
      }
      retries += 1
      setState('connecting')
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        if (!disposed) send.current({ type: 'WATCH', attempt_id: attemptId })
      }, RETRY_DELAY_MS)
    }

    const createPc = (servers: RTCIceServer[], id: string) => {
      const connection = new RTCPeerConnection({ iceServers: servers })
      connection.ontrack = (event) => {
        if (!disposed && pc === connection) setStream(event.streams[0] ?? new MediaStream([event.track]))
      }
      connection.onicecandidate = (event) => {
        if (event.candidate && pc === connection) {
          send.current({ type: 'ICE_CANDIDATE', attempt_id: attemptId, candidate: JSON.stringify(event.candidate), offer_id: id })
        }
      }
      connection.onconnectionstatechange = () => {
        if (disposed || pc !== connection) return
        const s = connection.connectionState
        if (s === 'connected') {
          retries = 0
          clearTimers()
          setState('connected')
        } else if (s === 'failed') {
          renegotiate()
        } else if (s === 'disconnected') {
          // Often recovers by itself (a brief network blip); renegotiate if it does not.
          setState('connecting')
          if (graceTimer === null) {
            graceTimer = window.setTimeout(() => {
              graceTimer = null
              if (!disposed && pc === connection && connection.connectionState !== 'connected') renegotiate()
            }, DISCONNECTED_GRACE_MS)
          }
        }
      }
      return connection
    }

    const onOffer = async (sdp: string, id: string) => {
      if (id === offerId) return // duplicate delivery of the offer being answered
      close() // a newer negotiation replaces the old connection
      offerId = id
      const servers = await iceServers
      if (disposed || offerId !== id) return
      const connection = createPc(servers, id)
      pc = connection
      await connection.setRemoteDescription({ type: 'offer', sdp })
      const mine = pendingIce.filter((p) => p.offerId === id)
      pendingIce = pendingIce.filter((p) => p.offerId !== id)
      for (const { ice } of mine) await connection.addIceCandidate(ice).catch(() => undefined)
      const answer = await connection.createAnswer()
      if (pc !== connection) return
      await connection.setLocalDescription(answer)
      send.current({ type: 'WEBRTC_ANSWER', attempt_id: attemptId, sdp: answer.sdp ?? '', offer_id: id })
    }

    const onSignal = (message: Signal) => {
      if (disposed) return
      void (async () => {
        try {
          const id = typeof message.offer_id === 'string' ? message.offer_id : ''
          if (message.type === 'PUBLISH_STATE') {
            if (message.publishing === false) setState('unavailable')
          } else if (message.type === 'WEBRTC_OFFER' && typeof message.sdp === 'string') {
            await onOffer(message.sdp, id)
          } else if (message.type === 'ICE_CANDIDATE' && typeof message.candidate === 'string') {
            const ice = JSON.parse(message.candidate) as RTCIceCandidateInit
            if (pc && id === offerId && pc.remoteDescription) await pc.addIceCandidate(ice).catch(() => undefined)
            else {
              // For the offer being set up, or one that has not arrived yet; stale ones age out.
              pendingIce.push({ offerId: id, ice })
              if (pendingIce.length > MAX_PENDING_ICE) pendingIce.splice(0, pendingIce.length - MAX_PENDING_ICE)
            }
          }
        } catch {
          renegotiate()
        }
      })()
    }

    const unsubscribe = signaling.subscribe(attemptId, onSignal)
    send.current({ type: 'WATCH', attempt_id: attemptId })

    return () => {
      disposed = true
      clearTimers()
      unsubscribe()
      send.current({ type: 'UNWATCH', attempt_id: attemptId })
      close()
    }
  }, [attemptId, enabled, signaling])

  return { state, stream }
}
