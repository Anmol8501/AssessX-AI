import { useEffect, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { AlertIcon, CameraIcon, CheckIcon, SpinnerIcon } from '@/components/icons'
import { Button } from '@/components/ui'
import { describeError } from '@/features/assessments/useAssessments'
import { useApi } from '@/features/session'
import { API_BASE_URL } from '@/lib/api'
import { socketBase } from '@/lib/wsTicket'

interface SecondaryCameraPairingProps {
  attemptId: string
  mandatory?: boolean
  orientation?: 'LANDSCAPE' | 'PORTRAIT' | 'ANY'
  onVerified(stream: MediaStream): void
  onCancel?(): void
}

export function SecondaryCameraPairing({
  attemptId,
  mandatory = false,
  orientation: _orientation = 'LANDSCAPE',
  onVerified,
  onCancel,
}: SecondaryCameraPairingProps) {
  const api = useApi()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pairingUrl, setPairingUrl] = useState<string>('')
  const [pairingToken, setPairingToken] = useState<string>('')
  const [copied, setCopied] = useState<boolean>(false)
  const [sessionId, setSessionId] = useState<string>('')
  const [status, setStatus] = useState<'pending' | 'paired' | 'streaming' | 'error'>('pending')
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)

  // 1. Fetch pairing session from backend
  async function fetchSession() {
    setLoading(true)
    setError(null)
    try {
      const data = await api<{
        session: { id: string }
        pairing_url: string
        pairing_token: string
      }>(`/api/v1/proctoring/secondary-camera/attempts/${attemptId}/session`, {
        method: 'POST',
      })
      setSessionId(data.session.id)
      setPairingUrl(data.pairing_url)
      setPairingToken(data.pairing_token)
      setLoading(false)
    } catch (err: any) {
      setError(describeError(err, 'Failed to create secondary camera session.'))
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchSession()
  }, [attemptId])

  // 2. Connect WebRTC signaling once session is created
  useEffect(() => {
    if (!sessionId) return

    const wsUrl = `${socketBase(API_BASE_URL)}/api/v1/proctoring/secondary-camera/ws/${sessionId}?role=desktop`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    let pc: RTCPeerConnection | null = null

    ws.onopen = async () => {
      // Fetch ICE servers
      const iceData = await api<{ ice_servers: RTCIceServer[] }>(
        `/api/v1/proctoring/secondary-camera/${sessionId}/ice-servers`,
      ).catch(() => null)
      const iceServers = iceData?.ice_servers || [{ urls: 'stun:stun.l.google.com:19302' }]

      pc = new RTCPeerConnection({ iceServers })
      pcRef.current = pc

      pc.ontrack = (event) => {
        const stream = event.streams[0] || null
        remoteStreamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
        setStatus('streaming')
      }

      pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate }))
        }
      }
    }

    ws.onmessage = async (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'peer_connected' && msg.role === 'mobile') {
          setStatus('paired')
        } else if (msg.type === 'offer' && pc) {
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          ws.send(JSON.stringify({ type: 'answer', sdp: answer }))
        } else if (msg.type === 'candidate' && pc) {
          await pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
        } else if (msg.type === 'peer_disconnected' && msg.role === 'mobile') {
          setStatus('pending')
        }
      } catch (err) {
        console.error('Desktop WebRTC signaling error:', err)
      }
    }

    // Polling session status fallback
    const pollInterval = setInterval(async () => {
      try {
        const s = await api<{ battery_level?: number | null; status: string }>(
          `/api/v1/proctoring/secondary-camera/${sessionId}/status`,
        )
        if (s.battery_level !== undefined && s.battery_level !== null) {
          setBatteryLevel(s.battery_level)
        }
        if (s.status === 'PAIRED' && status === 'pending') {
          setStatus('paired')
        }
      } catch {}
    }, 5000)

    return () => {
      clearInterval(pollInterval)
      ws.close()
      pc?.close()
    }
  }, [sessionId])

  function handleConfirmPlacement() {
    if (remoteStreamRef.current) {
      onVerified(remoteStreamRef.current)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent text-[12px] font-bold">
              2
            </span>
            <h3 className="text-[16px] font-semibold text-ink">Connect Secondary Camera (Mobile Phone)</h3>
          </div>
          <p className="mt-1 text-[13px] text-ink-subtle">
            This assessment requires an additional side-view camera using your smartphone to monitor your examination environment.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {status === 'pending' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-3 py-1 text-[11.5px] font-medium text-amber-600 dark:text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
              Waiting for mobile scan…
            </span>
          )}
          {status === 'paired' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/10 border border-sky-500/30 px-3 py-1 text-[11.5px] font-medium text-sky-600 dark:text-sky-400">
              <SpinnerIcon className="text-[12px] animate-spin" />
              Starting mobile stream…
            </span>
          )}
          {status === 'streaming' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-ok/10 border border-ok/30 px-3 py-1 text-[11.5px] font-medium text-ok">
              <CheckIcon className="text-[12px]" />
              Mobile Camera Streaming Live
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex h-56 flex-col items-center justify-center gap-2 text-ink-subtle">
          <SpinnerIcon className="text-2xl text-accent animate-spin" />
          <span className="text-[13px]">Generating secure pairing QR code…</span>
        </div>
      ) : error ? (
        <div className="my-6 rounded-lg border border-danger/30 bg-danger/10 p-4 text-center">
          <AlertIcon className="mx-auto text-2xl text-danger mb-2" />
          <p className="text-[13.5px] font-medium text-danger">{error}</p>
          <Button variant="secondary" size="sm" onClick={fetchSession} className="mt-3">
            Retry QR Generation
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Left Column: QR Code & Pairing Instructions */}
          <div className="flex flex-col items-center justify-center rounded-lg border border-line bg-card-muted/30 p-5 text-center">
            <div className="rounded-xl border border-line bg-white p-3 shadow-md flex items-center justify-center min-h-[210px] min-w-[210px]">
              {pairingUrl ? (
                <QRCodeSVG
                  value={pairingUrl}
                  size={190}
                  level="Q"
                  includeMargin
                  bgColor="#ffffff"
                  fgColor="#0f172a"
                />
              ) : (
                <div className="text-[12px] text-slate-400">Loading QR code…</div>
              )}
            </div>

            <h4 className="mt-4 text-[14px] font-semibold text-ink">Scan with your Mobile Phone</h4>
            <p className="mt-1 max-w-xs text-[12px] text-ink-subtle leading-relaxed">
              Open your phone's camera app or browser to scan this QR code. Grant camera permission to connect your secondary view.
            </p>

            {/* Direct Connection URL & Action Buttons */}
            <div className="mt-4 w-full text-left">
              <div className="flex items-center justify-between text-[11px] font-medium text-ink-subtle mb-1">
                <span>Direct Connection URL</span>
                <button
                  type="button"
                  onClick={() => {
                    if (pairingUrl) {
                      void navigator.clipboard.writeText(pairingUrl)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }
                  }}
                  className="text-accent hover:underline text-[11px] font-semibold cursor-pointer"
                >
                  {copied ? '✓ Copied!' : 'Copy Link'}
                </button>
              </div>
              <div className="rounded border border-line bg-surface p-2 text-[11px] font-mono text-ink break-all select-all max-h-16 overflow-y-auto">
                {pairingUrl || 'Generating URL…'}
              </div>

              <div className="mt-3 flex flex-col gap-2">
                <a
                  href={`#/mobile-camera?session_id=${sessionId}&token=${pairingToken}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-card hover:bg-card-muted px-3 py-1.5 text-[12px] font-medium text-accent shadow-sm transition-colors text-center"
                >
                  <span>↗ Open Mobile View in New Tab (Desktop Test)</span>
                </a>
                <p className="text-[10.5px] text-ink-subtle text-center">
                  💡 <strong>Tip:</strong> Phone must be on the same WiFi network (<code>192.168.1.11</code>). Or click above to test right in your browser.
                </p>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-subtle">
              <span>Single-use code</span>
              <span>·</span>
              <span>Valid for 15 minutes</span>
              {batteryLevel !== null && (
                <>
                  <span>·</span>
                  <span className="font-semibold text-ink">Phone Battery: {batteryLevel}%</span>
                </>
              )}
            </div>
          </div>

          {/* Right Column: Live Mobile Preview & Positioning Guide */}
          <div className="space-y-4">
            {status === 'streaming' ? (
              <div className="space-y-3">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-line bg-black shadow-inner">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute top-2.5 left-2.5 rounded bg-black/60 px-2 py-0.5 text-[10.5px] font-mono text-emerald-400 backdrop-blur">
                    SECONDARY VIEW (LIVE)
                  </div>
                </div>

                <div className="rounded-lg border border-ok/30 bg-ok/10 p-3 text-[12.5px] text-ok">
                  <strong className="block font-semibold">Camera connected successfully!</strong>
                  Verify below that your upper body, desk, keyboard, and computer are in view before continuing.
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-line-strong p-4 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent mb-2">
                  <CameraIcon className="text-xl" />
                </div>
                <h4 className="text-[13.5px] font-semibold text-ink">Mobile Live Preview</h4>
                <p className="mt-1 text-[12px] text-ink-subtle">
                  Once scanned, your phone's live video stream will appear here for verification.
                </p>
              </div>
            )}

            {/* Positioning Guide */}
            <div className="rounded-lg border border-line bg-card-muted/40 p-3.5 text-[12.5px] text-ink">
              <h5 className="font-semibold text-ink flex items-center gap-1.5 mb-1.5">
                <span>Recommended Camera Positioning</span>
              </h5>
              <ul className="space-y-1 text-ink-subtle text-[12px] list-disc pl-4 leading-relaxed">
                <li>Place your phone in a stable stand or holder at a <strong>diagonal side angle (45°)</strong>.</li>
                <li>Ensure the camera captures your <strong>seating position, upper body, hands, and desk</strong>.</li>
                <li>Keep the mobile phone stationary and connected to a charger if possible.</li>
                <li>Keep phone oriented horizontally (<strong>Landscape</strong>).</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Action Footer */}
      <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Back
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <Button
            variant="primary"
            onClick={handleConfirmPlacement}
            disabled={status !== 'streaming' && mandatory}
            leadingIcon={<CheckIcon />}
          >
            Confirm Camera Placement & Continue
          </Button>
        </div>
      </div>
    </div>
  )
}

