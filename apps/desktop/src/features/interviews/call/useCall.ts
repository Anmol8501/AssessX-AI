import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadIceServers } from '@/features/admin/monitoring/webrtc'
import { tokenStorage } from '@/features/session'
import { API_BASE_URL } from '@/lib/api'
import { callSocketUrl, chatText, mergeMessages, peerMedia, slotAt, SLOTS, type Slot } from './callLogic'
import type { CallRole, ChatMessage, PeerMedia } from './types'

const RECONNECT_MAX_MS = 8000

/**
 * - connecting: opening the signaling socket
 * - waiting: connected, the other side is not here
 * - negotiating: both here, video is being set up
 * - connected: video is flowing
 * - reconnecting: the socket dropped; retrying
 * - ended: the interviewer ended the call
 * - unavailable: the call is not open to this user (ended, or not theirs)
 * - occupied: someone else already holds this side of the call
 */
export type CallPhase = 'connecting' | 'waiting' | 'negotiating' | 'connected' | 'reconnecting' | 'ended' | 'unavailable' | 'occupied'

interface Signal {
  type: string
  [key: string]: unknown
}

export interface LiveCall {
  phase: CallPhase
  peerPresent: boolean
  /** The other side's own toggles, as they report them. */
  peer: PeerMedia | null
  localStream: MediaStream | null
  /** The other side's microphone and camera. */
  remoteStream: MediaStream | null
  /** The other side's shared screen (shown while `peer.screen`). */
  remoteScreen: MediaStream | null
  localScreen: MediaStream | null
  mediaError: string | null
  audio: boolean
  video: boolean
  sharing: boolean
  messages: ChatMessage[]
  toggleAudio(): void
  toggleVideo(): void
  toggleScreen(): Promise<void>
  /** False if the text is empty, too long, or the socket is not open. */
  sendChat(body: string): boolean
}

async function openMedia(): Promise<{ stream: MediaStream | null; error: string | null }> {
  const attempts: MediaStreamConstraints[] = [
    { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
    { audio: true, video: false },
    { audio: false, video: true },
  ]
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      const missing = !constraints.video ? 'camera' : !constraints.audio ? 'microphone' : null
      return { stream, error: missing ? `Your ${missing} is not available; the call continues without it.` : null }
    } catch {
      // try the next, smaller request
    }
  }
  return { stream: null, error: 'Camera and microphone are not available. You can still use the chat.' }
}

/**
 * One side of a one-to-one live interview call (Phase 7D).
 *
 * Signaling goes over the call's own authenticated WebSocket, which relays only between this call's
 * interviewer and candidate; the media itself is peer-to-peer (STUN/TURN from the server) and nothing is
 * recorded. The candidate always makes the offer and the interviewer answers, so the two never offer at
 * once. Each offer carries a fresh `offer_id`; answers and ICE candidates for any other id belong to an
 * older negotiation and are ignored. Every offer pre-negotiates three slots (microphone, camera, screen),
 * so muting, turning the camera off or sharing a screen only swaps a track — no renegotiation.
 *
 * `enabled` is false until the page has confirmed the call (and, for the candidate, joined it).
 */
export function useCall(callId: string, role: CallRole, initialMessages: ChatMessage[], enabled: boolean): LiveCall {
  const [phase, setPhase] = useState<CallPhase>('connecting')
  const [peerPresent, setPeerPresent] = useState(false)
  const [peer, setPeer] = useState<PeerMedia | null>(null)
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [remoteScreen, setRemoteScreen] = useState<MediaStream | null>(null)
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [audio, setAudio] = useState(true)
  const [video, setVideo] = useState(true)
  // Messages that arrived over the socket; shown merged with the record the page loaded.
  const [received, setReceived] = useState<ChatMessage[]>([])
  const messages = useMemo(() => mergeMessages(initialMessages, received), [initialMessages, received])

  // The live objects, shared by the effect and the controls.
  const live = useRef({
    socket: null as WebSocket | null,
    pc: null as RTCPeerConnection | null,
    local: null as MediaStream | null,
    screen: null as MediaStream | null,
    audio: true,
    video: true,
  })

  const send = useCallback((message: Signal) => {
    const socket = live.current.socket
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
      return true
    }
    return false
  }, [])

  const announce = useCallback(() => {
    const { local, screen, audio: a, video: v } = live.current
    send({
      type: 'MEDIA_STATE',
      audio: a && !!local?.getAudioTracks().length,
      video: v && !!local?.getVideoTracks().length,
      screen: !!screen,
    })
  }, [send])

  const trackFor = (slot: Slot): MediaStreamTrack | null => {
    const { local, screen } = live.current
    if (slot === 'audio') return local?.getAudioTracks()[0] ?? null
    if (slot === 'camera') return local?.getVideoTracks()[0] ?? null
    return screen?.getVideoTracks()[0] ?? null
  }

  useEffect(() => {
    if (!enabled) return
    const token = tokenStorage.get()
    if (!token) {
      void Promise.resolve().then(() => setPhase('unavailable'))
      return
    }
    const state = live.current
    let closed = false
    let retry = 500
    let retryTimer: number | null = null
    let generation = 0
    let offerId: string | null = null
    let pendingIce: RTCIceCandidateInit[] = []
    let queue: Promise<void> = Promise.resolve()

    const closePc = () => {
      generation++
      state.pc?.close()
      state.pc = null
      offerId = null
      pendingIce = []
      setRemoteStream(null)
      setRemoteScreen(null)
    }

    /** A fresh peer connection whose remote tracks land in the right place by slot. */
    const createPc = async (): Promise<RTCPeerConnection | null> => {
      closePc()
      const mine = ++generation
      const servers = await loadIceServers()
      if (closed || mine !== generation) return null
      const pc = new RTCPeerConnection({ iceServers: servers })
      state.pc = pc
      const main = new MediaStream()
      const screen = new MediaStream()
      pc.ontrack = (event) => {
        const slot = slotAt(pc.getTransceivers().indexOf(event.transceiver))
        // A fresh stream object each time, so the <video> element is handed every track.
        if (slot === 'screen') {
          screen.addTrack(event.track)
          setRemoteScreen(new MediaStream(screen.getTracks()))
        } else if (slot) {
          main.addTrack(event.track)
          setRemoteStream(new MediaStream(main.getTracks()))
        }
      }
      pc.onicecandidate = (event) => {
        if (event.candidate && offerId) send({ type: 'ICE', candidate: JSON.stringify(event.candidate), offer_id: offerId })
      }
      pc.onconnectionstatechange = () => {
        if (state.pc !== pc) return
        if (pc.connectionState === 'connected') setPhase('connected')
        else if (pc.connectionState === 'failed') {
          setPhase('negotiating')
          // The candidate offers again; the interviewer waits for that offer.
          if (role === 'candidate') window.setTimeout(() => void offer(), 1000)
        }
      }
      return pc
    }

    const offer = async () => {
      const pc = await createPc()
      if (!pc) return
      const id = `${Date.now().toString(36)}-${generation}`
      offerId = id
      for (const slot of SLOTS) {
        pc.addTransceiver(trackFor(slot) ?? (slot === 'audio' ? 'audio' : 'video'), { direction: 'sendrecv' })
      }
      const description = await pc.createOffer()
      await pc.setLocalDescription(description)
      if (state.pc !== pc) return // superseded while the offer was being made
      send({ type: 'OFFER', sdp: description.sdp ?? '', offer_id: id })
    }

    const answer = async (sdp: string, id: string | null) => {
      const pc = await createPc()
      if (!pc) return
      offerId = id
      await pc.setRemoteDescription({ type: 'offer', sdp })
      const transceivers = pc.getTransceivers()
      for (const [index, slot] of SLOTS.entries()) {
        const transceiver = transceivers[index]
        if (!transceiver) continue
        transceiver.direction = 'sendrecv'
        await transceiver.sender.replaceTrack(trackFor(slot))
      }
      const description = await pc.createAnswer()
      await pc.setLocalDescription(description)
      if (state.pc !== pc) return
      send({ type: 'ANSWER', sdp: description.sdp ?? '', ...(id ? { offer_id: id } : {}) })
      for (const ice of pendingIce.splice(0)) await pc.addIceCandidate(ice).catch(() => undefined)
    }

    const finish = (next: CallPhase) => {
      closed = true
      setPhase(next)
      setPeerPresent(false)
      closePc()
      state.socket?.close()
    }

    const onSignal = async (message: Signal) => {
      const id = typeof message.offer_id === 'string' ? message.offer_id : null
      switch (message.type) {
        case 'READY':
          setPeerPresent(message.peer_present === true)
          setPhase(message.peer_present === true ? 'negotiating' : 'waiting')
          announce()
          if (role === 'candidate' && message.peer_present === true) await offer()
          break
        case 'PEER_JOINED':
          setPeerPresent(true)
          setPhase('negotiating')
          announce()
          if (role === 'candidate') await offer()
          break
        case 'PEER_LEFT':
          closePc()
          setPeerPresent(false)
          setPeer(null)
          setPhase('waiting')
          break
        case 'OFFER':
          if (role === 'interviewer' && typeof message.sdp === 'string') await answer(message.sdp, id)
          break
        case 'ANSWER':
          if (role === 'candidate' && typeof message.sdp === 'string' && state.pc && id === offerId) {
            await state.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp })
            for (const ice of pendingIce.splice(0)) await state.pc.addIceCandidate(ice).catch(() => undefined)
          }
          break
        case 'ICE':
          if (typeof message.candidate === 'string' && id === offerId) {
            const ice = JSON.parse(message.candidate) as RTCIceCandidateInit
            if (state.pc?.remoteDescription) await state.pc.addIceCandidate(ice).catch(() => undefined)
            else pendingIce.push(ice)
          }
          break
        case 'MEDIA_STATE':
          setPeer(peerMedia(message))
          break
        case 'CHAT':
          if (message.message && typeof message.message === 'object') {
            setReceived((current) => mergeMessages(current, [message.message as ChatMessage]))
          }
          break
        case 'CALL_ENDED':
          finish('ended')
          break
        case 'ERROR':
          finish(message.error === 'occupied' ? 'occupied' : 'unavailable')
          break
      }
    }

    const connect = () => {
      if (closed) return
      const ws = new WebSocket(callSocketUrl(API_BASE_URL, callId, token))
      state.socket = ws
      ws.onmessage = (raw) => {
        let message: Signal
        try {
          message = JSON.parse(raw.data as string) as Signal
        } catch {
          return // ignore malformed
        }
        // One at a time, in arrival order: an ICE candidate must not overtake the offer it belongs to.
        queue = queue.then(() => onSignal(message)).catch(() => undefined)
      }
      ws.onopen = () => {
        retry = 500
      }
      ws.onclose = () => {
        if (state.socket === ws) state.socket = null
        if (closed) return
        closePc()
        setPeerPresent(false)
        setPhase('reconnecting')
        retryTimer = window.setTimeout(connect, retry)
        retry = Math.min(retry * 2, RECONNECT_MAX_MS)
      }
      ws.onerror = () => ws.close()
    }

    void openMedia().then(({ stream, error }) => {
      if (closed) {
        stream?.getTracks().forEach((t) => t.stop())
        return
      }
      state.local = stream
      setLocalStream(stream)
      setMediaError(error)
      connect()
    })

    return () => {
      closed = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      closePc()
      state.socket?.close()
      state.socket = null
      state.local?.getTracks().forEach((t) => t.stop())
      state.screen?.getTracks().forEach((t) => t.stop())
      state.local = null
      state.screen = null
      setLocalStream(null)
      setLocalScreen(null)
    }
    // trackFor only reads refs, so it is not a dependency.
  }, [callId, role, enabled, announce, send])

  const screenSender = () => live.current.pc?.getTransceivers()[SLOTS.indexOf('screen')]?.sender ?? null

  const stopShare = useCallback(() => {
    const state = live.current
    state.screen?.getTracks().forEach((t) => t.stop())
    state.screen = null
    setLocalScreen(null)
    void screenSender()?.replaceTrack(null).catch(() => undefined)
    announce()
  }, [announce])

  const toggleScreen = useCallback(async () => {
    if (live.current.screen) {
      stopShare()
      return
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track = screen.getVideoTracks()[0]
      if (!track) return
      track.onended = () => {
        if (live.current.screen === screen) stopShare()
      }
      live.current.screen = screen
      setLocalScreen(screen)
      await screenSender()?.replaceTrack(track)
      announce()
    } catch {
      // The person cancelled the picker, or sharing is not allowed — nothing changes.
    }
  }, [announce, stopShare])

  const toggleAudio = useCallback(() => {
    const state = live.current
    state.audio = !state.audio
    state.local?.getAudioTracks().forEach((t) => (t.enabled = state.audio))
    setAudio(state.audio)
    announce()
  }, [announce])

  const toggleVideo = useCallback(() => {
    const state = live.current
    state.video = !state.video
    state.local?.getVideoTracks().forEach((t) => (t.enabled = state.video))
    setVideo(state.video)
    announce()
  }, [announce])

  const sendChat = useCallback(
    (body: string) => {
      const text = chatText(body)
      return text !== null && send({ type: 'CHAT', body: text })
    },
    [send],
  )

  return {
    phase,
    peerPresent,
    peer,
    localStream,
    remoteStream,
    remoteScreen,
    localScreen,
    mediaError,
    audio,
    video,
    sharing: localScreen !== null,
    messages,
    toggleAudio,
    toggleVideo,
    toggleScreen,
    sendChat,
  }
}
