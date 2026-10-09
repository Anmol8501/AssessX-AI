import { useEffect, useRef } from 'react'
import { tokenStorage } from '@/features/session'
import { API_BASE_URL } from '@/lib/api'
import { loadIceServers } from '@/features/admin/monitoring/webrtc'
import { CONTROL_EVENT } from './useAttemptControl'
import type { MediaDevice } from '../useMediaDevice'
import { socketBase, socketTicket } from '@/lib/wsTicket'

const RECONNECT_MAX_MS = 8000

interface Signal {
  type: string
  [key: string]: unknown
}

/** The proctoring socket, opened with a one-time ticket — never the session token (Phase 8A). */
function wsUrl(ticket: string, attemptId: string): string {
  return `${socketBase(API_BASE_URL)}/api/v1/ws/candidates/me/proctoring?ticket=${encodeURIComponent(ticket)}&attempt_id=${attemptId}`
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
 *
 * Every offer carries a fresh `offer_id`, echoed on the admin's answer and ICE candidates. Messages
 * for any other id belong to an older negotiation (a retry, a reconnect, a view reopened quickly) and
 * are ignored — applying them would point this connection at a peer that no longer exists.
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
    let generation = 0 // only the newest publish() may install its peer connection
    let offerId: string | null = null // the negotiation the current peer connection belongs to

    const send = (message: Signal) => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }

    const closePc = () => {
      generation++ // also cancels a publish() still waiting for its ICE servers (e.g. after UNWATCH)
      pc?.close()
      pc = null
      offerId = null
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
      const mine = ++generation
      // STUN/TURN from the server, so video can reach an admin on another network.
      const servers = await loadIceServers()
      if (closed || mine !== generation) return
      const connection = new RTCPeerConnection({ iceServers: servers })
      const id = `${Date.now().toString(36)}-${mine}`
      pc = connection
      offerId = id
      for (const track of tracks) {
        const sender = connection.addTrack(track, cam ?? mic!)
        if (track.kind === 'video') void limitLiveVideo(sender, track)
      }
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          send({ type: 'ICE_CANDIDATE', attempt_id: attemptId, candidate: JSON.stringify(event.candidate), offer_id: id })
        }
      }
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)
      if (pc !== connection) return // superseded while the offer was being created
      send({ type: 'WEBRTC_OFFER', attempt_id: attemptId, sdp: offer.sdp ?? '', offer_id: id })
    }

    const onSignal = (message: Signal) => {
      void (async () => {
        try {
          if (message.type === 'ATTEMPT_CONTROL') {
            // Exam control (tab switches, hold): handed to the exam screen, which owns that state.
            window.dispatchEvent(new CustomEvent(CONTROL_EVENT, { detail: message }))
          } else if (message.type === 'WATCH') {
            await publish()
          } else if (message.type === 'UNWATCH') {
            closePc()
          } else if (message.type === 'WEBRTC_ANSWER' && typeof message.sdp === 'string' && pc) {
            if (message.offer_id !== offerId) return // an answer to an older offer
            await pc.setRemoteDescription({ type: 'answer', sdp: message.sdp })
            for (const ice of pendingIce.splice(0)) await pc.addIceCandidate(ice).catch(() => undefined)
          } else if (message.type === 'ICE_CANDIDATE' && typeof message.candidate === 'string') {
            if (message.offer_id !== offerId) return // belongs to an older negotiation
            const ice = JSON.parse(message.candidate) as RTCIceCandidateInit
            if (pc?.remoteDescription) await pc.addIceCandidate(ice).catch(() => undefined)
            else pendingIce.push(ice)
          }
        } catch {
          // A failed negotiation must not crash the exam; the admin viewer shows "unavailable".
        }
      })()
    }

    const retryLater = () => {
      if (closed) return
      retryTimer = window.setTimeout(connect, retry)
      retry = Math.min(retry * 2, RECONNECT_MAX_MS)
    }
    const connect = () => {
      if (closed) return
      void socketTicket(token, 'proctoring').then((ticket) => {
        if (closed) return
        const ws = new WebSocket(wsUrl(ticket, attemptId))
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
          retryLater()
        }
        ws.onopen = () => {
          retry = 500
        }
        ws.onerror = () => ws.close()
      }, retryLater)
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

/** The live view's video width. The camera itself runs at a higher resolution for the on-device AI. */
const LIVE_VIDEO_WIDTH = 640

/**
 * Sends the live view at about `LIVE_VIDEO_WIDTH` wide however large the camera image is, so the
 * camera's higher resolution (kept for small-object detection on the device) costs no extra upload.
 * Best effort: if the browser refuses, the video is sent as it is.
 */
async function limitLiveVideo(sender: RTCRtpSender, track: MediaStreamTrack): Promise<void> {
  const width = track.getSettings().width ?? 0
  if (width <= LIVE_VIDEO_WIDTH || typeof sender.getParameters !== 'function') return
  try {
    const parameters = sender.getParameters()
    const encodings = parameters.encodings?.length ? parameters.encodings : [{}]
    await sender.setParameters({ ...parameters, encodings: encodings.map((e) => ({ ...e, scaleResolutionDownBy: width / LIVE_VIDEO_WIDTH })) })
  } catch {
    // Not supported here: the live view simply uses the camera's own resolution.
  }
}
