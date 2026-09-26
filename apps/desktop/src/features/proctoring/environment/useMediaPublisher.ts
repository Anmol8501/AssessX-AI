import { useEffect, useRef } from 'react'
import { tokenStorage } from '@/features/session'
import { API_BASE_URL } from '@/lib/api'
import { iceServers } from '@/features/admin/monitoring/webrtc'
import type { MediaDevice } from '../useMediaDevice'

const RECONNECT_MAX_MS = 8000

interface Signal {
  type: string
  [key: string]: unknown
}

function wsUrl(token: string, attemptId: string): string {
  const base = API_BASE_URL.replace(/^http/, 'ws')
  return `${base}/api/v1/ws/candidates/me/proctoring?token=${encodeURIComponent(token)}&attempt_id=${attemptId}`
}

/**
 * Publishes the candidate's live camera + microphone to a watching admin (Phase 4C).
 *
 * It reuses the streams the proctoring check already opened (`useMediaDevice`) — no extra
 * `getUserMedia`, no second camera capture — and negotiates WebRTC over the candidate signaling
 * WebSocket when an admin chooses to watch. Media flows peer-to-peer; nothing is recorded or sent
 * through the WebSocket. When the admin stops watching, the exam ends, or the component unmounts,
 * the peer connection and socket are torn down cleanly.
 *
 * One viewer at a time: the live wall establishes video only from the admin's detail view, so a
 * candidate is watched by at most one admin. A second concurrent viewer is out of scope here.
 */
export function useMediaPublisher(attemptId: string, camera: MediaDevice, microphone: MediaDevice): void {
  const cameraStream = camera.stream
  const micStream = microphone.stream
  const streamsRef = useRef({ cameraStream, micStream })
  useEffect(() => {
    streamsRef.current = { cameraStream, micStream }
  }, [cameraStream, micStream])

  useEffect(() => {
    const token = tokenStorage.get()
    if (!token) return

    let socket: WebSocket | null = null
    let pc: RTCPeerConnection | null = null
    let pendingIce: RTCIceCandidateInit[] = []
    let retry = 500
    let retryTimer: number | null = null
    let closed = false

    const send = (message: Signal) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }

    const closePc = () => {
      pc?.close()
      pc = null
      pendingIce = []
    }

    const publish = async () => {
      const { cameraStream: cam, micStream: mic } = streamsRef.current
      const tracks = [...(cam?.getVideoTracks() ?? []), ...(mic?.getAudioTracks() ?? [])]
      if (tracks.length === 0) {
        send({ type: 'PUBLISH_STATE', attempt_id: attemptId, publishing: false })
        return
      }
      closePc()
      const connection = new RTCPeerConnection({ iceServers: iceServers() })
      pc = connection
      for (const track of tracks) connection.addTrack(track, cam ?? mic!)
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          send({ type: 'ICE_CANDIDATE', attempt_id: attemptId, candidate: JSON.stringify(event.candidate) })
        }
      }
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)
      send({ type: 'WEBRTC_OFFER', attempt_id: attemptId, sdp: offer.sdp ?? '' })
    }

    const onSignal = (message: Signal) => {
      void (async () => {
        try {
          if (message.type === 'WATCH') {
            await publish()
          } else if (message.type === 'UNWATCH') {
            closePc()
          } else if (message.type === 'WEBRTC_ANSWER' && typeof message.sdp === 'string' && pc) {
            await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp })
            for (const ice of pendingIce.splice(0)) await pc.addIceCandidate(ice).catch(() => undefined)
          } else if (message.type === 'ICE_CANDIDATE' && typeof message.candidate === 'string') {
            const ice = JSON.parse(message.candidate) as RTCIceCandidateInit
            if (pc?.remoteDescription) await pc.addIceCandidate(ice).catch(() => undefined)
            else pendingIce.push(ice)
          }
        } catch {
          // A failed negotiation must not crash the exam; the admin viewer shows "unavailable".
        }
      })()
    }

    const connect = () => {
      if (closed) return
      const ws = new WebSocket(wsUrl(token, attemptId))
      socket = ws
      ws.onmessage = (raw) => {
        try {
          onSignal(JSON.parse(raw.data as string) as Signal)
        } catch {
          /* ignore malformed */
        }
      }
      ws.onclose = () => {
        if (socket === ws) socket = null
        closePc()
        if (closed) return
        retryTimer = window.setTimeout(connect, retry)
        retry = Math.min(retry * 2, RECONNECT_MAX_MS)
      }
      ws.onopen = () => {
        retry = 500
      }
      ws.onerror = () => ws.close()
    }
    connect()

    return () => {
      closed = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      closePc()
      socket?.close()
    }
  }, [attemptId])
}
