import { tokenStorage } from '@/features/session'
import { apiRequest } from '@/lib/api'

/**
 * WebRTC configuration for live monitoring media (Phase 4C).
 *
 * ICE servers come from the API (`GET /api/v1/realtime/ice-servers`): STUN always, so two laptops on
 * different networks can find each other, and TURN when the server is configured for it, so video
 * still connects on networks that forbid direct connections (mobile hotspots, campus Wi-Fi). TURN
 * credentials are short-lived and issued by the server; none are built into the app.
 *
 * `VITE_ICE_SERVERS` (a JSON array of `RTCIceServer`) overrides the server's list when set — for
 * development or testing only. If the server cannot be reached, the last list is reused, else none
 * (host candidates only — enough on one local network).
 */

interface IceServersResponse {
  ice_servers: { urls: string[]; username?: string; credential?: string }[]
  turn_enabled: boolean
}

/** Server lists are refreshed after this long (TURN credentials are renewed server-side). */
const CACHE_MS = 10 * 60_000

let cached: { servers: RTCIceServer[]; at: number } | null = null

function buildTimeOverride(): RTCIceServer[] | null {
  const raw = import.meta.env.VITE_ICE_SERVERS as string | undefined
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : null
  } catch {
    return null
  }
}

export async function loadIceServers(): Promise<RTCIceServer[]> {
  const override = buildTimeOverride()
  if (override) return override
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.servers
  try {
    const response = await apiRequest<IceServersResponse>('/api/v1/realtime/ice-servers', { token: tokenStorage.get() })
    const servers: RTCIceServer[] = response.ice_servers.map(({ urls, username, credential }) =>
      username && credential ? { urls, username, credential } : { urls },
    )
    cached = { servers, at: Date.now() }
    return servers
  } catch {
    return cached?.servers ?? []
  }
}

/** WebRTC media/connection state, tracked separately from the exam/proctoring session state. */
export type MediaState = 'idle' | 'connecting' | 'connected' | 'unavailable' | 'failed'
