import { useEffect, useRef, useState } from 'react'
import { Logo } from '@/components/Logo'
import { AlertIcon, CameraIcon, RefreshIcon, SpinnerIcon } from '@/components/icons'

interface MobileCameraPageProps {
  sessionId?: string
  token?: string
}

export function MobileCameraPage({ sessionId: propSessionId, token: propToken }: MobileCameraPageProps) {
  // Extract session_id and token from query string / hash if not provided via props
  const [sessionId, setSessionId] = useState<string>(propSessionId || '')
  const [token, setToken] = useState<string>(propToken || '')

  const [pairingStatus, setPairingStatus] = useState<'idle' | 'pairing' | 'paired' | 'error'>('idle')
  const [streamStatus, setStreamStatus] = useState<'idle' | 'requesting_camera' | 'streaming' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [examTitle, setExamTitle] = useState<string>('')
  const [candidateName, setCandidateName] = useState<string>('')
  const [mobileToken, setMobileToken] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [isPortrait, setIsPortrait] = useState<boolean>(window.innerHeight > window.innerWidth)
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)

  // 1. Parse params on mount
  useEffect(() => {
    // Check hash query params: #/mobile-camera?session_id=...&token=...
    const hash = window.location.hash
    const hashQueryIdx = hash.indexOf('?')
    const searchParams = new URLSearchParams(window.location.search)
    let sId = searchParams.get('session_id') || ''
    let tkn = searchParams.get('token') || ''

    if (!sId && hashQueryIdx !== -1) {
      const hashParams = new URLSearchParams(hash.slice(hashQueryIdx))
      sId = hashParams.get('session_id') || ''
      tkn = hashParams.get('token') || ''
    }

    if (sId) setSessionId(sId)
    if (tkn) setToken(tkn)
  }, [])

  // 2. Orientation & battery listeners
  useEffect(() => {
    const handleResize = () => {
      setIsPortrait(window.innerHeight > window.innerWidth)
    }
    window.addEventListener('resize', handleResize)
    window.addEventListener('orientationchange', handleResize)

    // Battery API if supported
    if ('getBattery' in navigator) {
      ;(navigator as any).getBattery?.().then((battery: any) => {
        setBatteryLevel(Math.round(battery.level * 100))
        battery.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(battery.level * 100))
        })
      }).catch(() => {})
    }

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('orientationchange', handleResize)
    }
  }, [])

  // 3. Pair device with server
  useEffect(() => {
    if (!sessionId || !token || pairingStatus !== 'idle') return

    async function pair() {
      setPairingStatus('pairing')
      try {
        const payload = JSON.stringify({
          session_id: sessionId,
          token,
          device_info: `${navigator.userAgent} (${window.screen.width}x${window.screen.height})`,
        })

        // Try same-origin via Vite proxy first, fallback to direct port 8000
        let res = await fetch('/api/v1/proctoring/secondary-camera/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        }).catch(() => null)

        if (!res || !res.ok) {
          const directUrl = `${window.location.protocol}//${window.location.hostname}:8000/api/v1/proctoring/secondary-camera/pair`
          res = await fetch(directUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          })
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.detail || err.message || 'Failed to pair device. QR code may be expired.')
        }

        const data = await res.json()
        setMobileToken(data.mobile_token)
        setExamTitle(data.assessment_title)
        setCandidateName(data.candidate_name)
        setPairingStatus('paired')
      } catch (err: any) {
        setPairingStatus('error')
        setErrorMessage(err.message || 'Pairing error')
      }
    }

    void pair()
  }, [sessionId, token, pairingStatus])

  // 4. Start Camera once paired
  useEffect(() => {
    if (pairingStatus !== 'paired') return

    async function startCamera() {
      setStreamStatus('requesting_camera')
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error(
            'Camera access requires a Secure Context (HTTPS or localhost). If opening on mobile over WiFi HTTP, allow insecure origins in chrome://flags/#unsafely-treat-insecure-origin-as-secure or test via desktop browser.',
          )
        }

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop())
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
          audio: false,
        })

        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setStreamStatus('streaming')
      } catch (err: any) {
        setStreamStatus('error')
        setErrorMessage(
          err.name === 'NotAllowedError'
            ? 'Camera permission denied. Please allow camera access in your mobile browser settings.'
            : 'Unable to open mobile camera: ' + err.message,
        )
      }
    }

    void startCamera()

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [pairingStatus, facingMode])

  // 5. WebRTC signaling connection to desktop
  useEffect(() => {
    if (streamStatus !== 'streaming' || !mobileToken || !streamRef.current) return

    const stream = streamRef.current
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    // Connect through Vite proxy if on web port 1420, or direct host
    const wsUrl = `${wsProtocol}//${window.location.host}/api/v1/proctoring/secondary-camera/ws/${sessionId}?role=mobile&token=${encodeURIComponent(mobileToken)}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    let pc: RTCPeerConnection | null = null

    ws.onopen = async () => {
      // Fetch ICE servers
      let iceRes = await fetch(`/api/v1/proctoring/secondary-camera/${sessionId}/ice-servers`).catch(() => null)
      if (!iceRes || !iceRes.ok) {
        const directIce = `${window.location.protocol}//${window.location.hostname}:8000/api/v1/proctoring/secondary-camera/${sessionId}/ice-servers`
        iceRes = await fetch(directIce).catch(() => null)
      }
      const iceData = iceRes?.ok ? await iceRes.json() : null
      const iceServers = iceData?.ice_servers || [{ urls: 'stun:stun.l.google.com:19302' }]

      pc = new RTCPeerConnection({ iceServers })
      pcRef.current = pc

      // Add local secondary camera tracks to WebRTC peer connection
      stream.getTracks().forEach((track) => pc?.addTrack(track, stream))

      pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }))
        }
      }

      // Create WebRTC Offer to Desktop
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      ws.send(JSON.stringify({ type: 'offer', sdp: offer }))
    }

    ws.onmessage = async (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'answer' && pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
        } else if (msg.type === 'candidate' && pc) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
        } else if (msg.type === 'peer_connected') {
          // Re-send offer if desktop joined after mobile
          if (pc && pc.localDescription) {
            ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }))
          }
        }
      } catch (err) {
        console.error('Signaling error:', err)
      }
    }

    // Heartbeat every 10s
    const heartbeatInterval = setInterval(() => {
      const hbPayload = JSON.stringify({
        session_id: sessionId,
        mobile_token: mobileToken,
        battery_level: batteryLevel,
        status: 'STREAMING',
      })
      void fetch('/api/v1/proctoring/secondary-camera/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hbPayload,
      }).catch(() => {
        const directHb = `${window.location.protocol}//${window.location.hostname}:8000/api/v1/proctoring/secondary-camera/heartbeat`
        void fetch(directHb, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: hbPayload,
        }).catch(() => {})
      })
    }, 10000)

    return () => {
      clearInterval(heartbeatInterval)
      ws.close()
      pc?.close()
    }
  }, [streamStatus, mobileToken, sessionId, batteryLevel])

  function toggleCamera() {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
  }

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-950 text-white select-none overflow-hidden font-sans">
      {/* Top Header */}
      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/90 px-4 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <Logo size="sm" />
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-white leading-tight">AssessX Secondary View</span>
            <span className="text-[11px] text-slate-400 leading-tight">
              {examTitle ? examTitle : 'Mobile Proctoring'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {batteryLevel !== null && (
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-mono font-medium ${
                batteryLevel <= 20 ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-800 text-slate-300'
              }`}
            >
              ⚡ {batteryLevel}%
            </span>
          )}
          {streamStatus === 'streaming' && (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          )}
        </div>
      </header>

      {/* Main Video Area */}
      <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />

        {/* Orientation Warning Banner (if portrait) */}
        {isPortrait && streamStatus === 'streaming' && (
          <div className="absolute top-4 inset-x-4 z-20 rounded-lg border border-amber-500/40 bg-amber-950/85 p-3 text-amber-200 backdrop-blur shadow-lg flex items-center gap-3 animate-fade-in">
            <AlertIcon className="text-xl shrink-0 text-amber-400" />
            <div className="text-[12px] leading-snug">
              <span className="font-semibold block">Landscape Orientation Recommended</span>
              Please rotate your phone horizontally for an optimal side view of your workstation.
            </div>
          </div>
        )}

        {/* Camera Overlay HUD */}
        {streamStatus === 'streaming' && (
          <div className="absolute bottom-4 inset-x-4 z-10 flex items-center justify-between">
            <button
              type="button"
              onClick={toggleCamera}
              className="flex items-center gap-1.5 rounded-full bg-slate-900/80 border border-white/20 px-3 py-1.5 text-[12px] font-medium text-white shadow-lg active:scale-95 transition-transform"
            >
              <RefreshIcon className="text-[13px]" />
              Flip Camera ({facingMode === 'environment' ? 'Rear' : 'Front'})
            </button>

            <span className="rounded-full bg-slate-900/80 border border-white/10 px-3 py-1.5 text-[11.5px] text-slate-300 backdrop-blur">
              {candidateName || 'Candidate Verified'}
            </span>
          </div>
        )}

        {/* Loading / Error States */}
        {pairingStatus === 'idle' && (!sessionId || !token) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 p-6 text-center">
            <div className="rounded-full bg-amber-500/20 p-3 mb-3">
              <AlertIcon className="text-3xl text-amber-400" />
            </div>
            <h3 className="text-[16px] font-semibold text-white">No Pairing Session Specified</h3>
            <p className="text-[13px] text-slate-400 mt-2 max-w-xs leading-relaxed">
              Please scan the QR code displayed on the AssessX desktop exam screen using your phone's camera.
            </p>
          </div>
        )}

        {pairingStatus === 'pairing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 p-6 text-center">
            <SpinnerIcon className="text-4xl text-sky-400 animate-spin mb-3" />
            <h3 className="text-[16px] font-semibold text-white">Connecting to Examination Session…</h3>
            <p className="text-[13px] text-slate-400 mt-1 max-w-xs">
              Verifying single-use pairing token with AssessX desktop application.
            </p>
          </div>
        )}

        {streamStatus === 'requesting_camera' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 p-6 text-center">
            <CameraIcon className="text-4xl text-sky-400 mb-3" />
            <h3 className="text-[16px] font-semibold text-white">Starting Mobile Camera…</h3>
            <p className="text-[13px] text-slate-400 mt-1 max-w-xs">
              Please grant camera permission in your browser prompt.
            </p>
          </div>
        )}

        {(pairingStatus === 'error' || streamStatus === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 p-6 text-center">
            <div className="rounded-full bg-red-500/20 p-3 mb-3">
              <AlertIcon className="text-3xl text-red-400" />
            </div>
            <h3 className="text-[16px] font-semibold text-white">Connection Error</h3>
            <p className="text-[13px] text-red-300 mt-2 max-w-xs leading-relaxed">
              {errorMessage || 'Unable to establish camera connection.'}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-medium px-4 py-2 text-[13px] transition-colors"
            >
              Retry Connection
            </button>
          </div>
        )}
      </div>

      {/* Bottom Instructions Footer */}
      <footer className="border-t border-white/10 bg-slate-900 px-4 py-2.5 text-center text-[11.5px] text-slate-400">
        <p>
          ⚠️ <strong className="text-slate-200">Keep this screen open and active.</strong> Do not lock your phone or switch apps during the exam.
        </p>
      </footer>
    </div>
  )
}

