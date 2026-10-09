import { API_BASE_URL } from './api'

export type SocketPurpose = 'monitoring' | 'proctoring' | 'call'

/**
 * A short-lived, single-use ticket for opening one WebSocket (Phase 8A). Fetched with the normal
 * Authorization header, so the session token itself never appears in a WebSocket URL, where proxies may
 * log it. Each connection — and each reconnection — asks for a fresh ticket.
 */
export async function socketTicket(token: string, purpose: SocketPurpose): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/v1/realtime/ws-ticket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose }),
  })
  if (!response.ok) throw new Error(`ticket refused (${response.status})`)
  const body = (await response.json()) as { ticket: string }
  return body.ticket
}

/** The WebSocket base for the API (http → ws, https → wss). */
export function socketBase(apiBase: string = API_BASE_URL): string {
  return apiBase.replace(/^http/, 'ws')
}
