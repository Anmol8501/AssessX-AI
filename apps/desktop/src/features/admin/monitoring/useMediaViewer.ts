import { useEffect, useRef, useState } from 'react'
import { iceServers, type MediaState } from './webrtc'
import type { MonitoringSignaling, Signal } from './useMonitoring'

interface Viewer {
  state: MediaState
  stream: MediaStream | null
}

/**
 * The admin's live-video viewer for one candidate (Phase 4C).
 *
 * It watches a candidate's media by signaling over the monitoring WebSocket: it asks to WATCH, the
 * candidate publishes an offer, this side answers, and ICE is exchanged. Media then flows
 * peer-to-peer over WebRTC — never through the WebSocket or REST. When `enabled` is false (a tile
 * the admin is not currently viewing, or media that never arrives) it reports an honest state
 * rather than fake video, and it tears the peer connection down.
 *
 * Everything is cleaned up on unmount or when disabled: the WATCH is released, the peer connection
 * is closed and remote tracks stopped, so no connection or stream leaks.
 */
export function useMediaViewer(attemptId: string, enabled: boolean, signaling: MonitoringSignaling): Viewer {
  const [state, setState] = useState<MediaState>('idle')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const pc = useRef<RTCPeerConnection | null>(null)
  const pendingIce = useRef<RTCIceCandidateInit[]>([])

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
    setState('connecting')
    pendingIce.current = []

    const close = () => {
      pc.current?.getReceivers().forEach((r) => r.track?.stop())
      pc.current?.close()
      pc.current = null
      setStream(null)
    }

    const ensurePc = () => {
      if (pc.current) return pc.current
      const connection = new RTCPeerConnection({ iceServers: iceServers() })
      connection.ontrack = (event) => {
        if (!disposed) setStream(event.streams[0] ?? new MediaStream([event.track]))
      }
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          send.current({ type: 'ICE_CANDIDATE', attempt_id: attemptId, candidate: JSON.stringify(event.candidate) })
        }
      }
      connection.onconnectionstatechange = () => {
        if (disposed) return
        const s = connection.connectionState
        if (s === 'connected') setState('connected')
        else if (s === 'failed') setState('failed')
        else if (s === 'disconnected' || s === 'closed') setState('connecting')
      }
      pc.current = connection
      return connection
    }

    const onSignal = (message: Signal) => {
      if (disposed) return
      void (async () => {
        try {
          if (message.type === 'PUBLISH_STATE') {
            if (message.publishing === false) setState('unavailable')
          } else if (message.type === 'WEBRTC_OFFER' && typeof message.sdp === 'string') {
            const connection = ensurePc()
            await connection.setRemoteDescription({ type: 'offer', sdp: message.sdp })
            for (const ice of pendingIce.current.splice(0)) await connection.addIceCandidate(ice).catch(() => undefined)
            const answer = await connection.createAnswer()
            await connection.setLocalDescription(answer)
            send.current({ type: 'WEBRTC_ANSWER', attempt_id: attemptId, sdp: answer.sdp ?? '' })
          } else if (message.type === 'ICE_CANDIDATE' && typeof message.candidate === 'string') {
            const ice = JSON.parse(message.candidate) as RTCIceCandidateInit
            if (pc.current?.remoteDescription) await pc.current.addIceCandidate(ice).catch(() => undefined)
            else pendingIce.current.push(ice)
          }
        } catch {
          if (!disposed) setState('failed')
        }
      })()
    }

    const unsubscribe = signaling.subscribe(attemptId, onSignal)
    send.current({ type: 'WATCH', attempt_id: attemptId })

    return () => {
      disposed = true
      unsubscribe()
      send.current({ type: 'UNWATCH', attempt_id: attemptId })
      close()
    }
  }, [attemptId, enabled, signaling])

  return { state, stream }
}
