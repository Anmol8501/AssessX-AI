/**
 * WebRTC configuration for live monitoring media (Phase 4C).
 *
 * ICE servers are configurable and never hard-coded with production TURN credentials. The default
 * is host/mDNS candidates only (empty list), which is enough for same-machine and simple-LAN
 * testing. A real deployment across networks needs a STUN server, and NAT traversal needs TURN;
 * set `VITE_ICE_SERVERS` to a JSON array of `RTCIceServer` objects. **TURN has not been tested.**
 */

export function iceServers(): RTCIceServer[] {
  const raw = import.meta.env.VITE_ICE_SERVERS as string | undefined
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : []
  } catch {
    return []
  }
}

/** WebRTC media/connection state, tracked separately from the exam/proctoring session state. */
export type MediaState = 'idle' | 'connecting' | 'connected' | 'unavailable' | 'failed'
