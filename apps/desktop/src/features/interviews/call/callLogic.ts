import type { ChatMessage, PeerMedia } from './types'

/**
 * The pure parts of a live call (Phase 7D), kept apart from WebRTC so they can be unit-tested.
 */

/** The signaling socket for one call. The token goes in the query: a browser WebSocket cannot set headers. */
export function callSocketUrl(apiBase: string, callId: string, token: string): string {
  return `${apiBase.replace(/^http/, 'ws')}/api/v1/ws/interview-calls/${callId}?token=${encodeURIComponent(token)}`
}

/**
 * Every offer pre-negotiates the same three slots, in this order, so turning the camera off or starting a
 * screen share only swaps a track (`replaceTrack`) and never needs a second negotiation.
 */
export const SLOTS = ['audio', 'camera', 'screen'] as const
export type Slot = (typeof SLOTS)[number]

export function slotAt(index: number): Slot | null {
  return SLOTS[index] ?? null
}

/** Adds messages (from the server's record or the socket) once each, in the order they were sent. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(current.map((m) => m.message_id))
  const added = incoming.filter((m) => !seen.has(m.message_id) && seen.add(m.message_id))
  if (added.length === 0) return current
  return [...current, ...added].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.message_id.localeCompare(b.message_id))
}

/** Seconds since the call opened (until it ended, if it has). Never negative. */
export function elapsedSeconds(openedAt: string, now: number, endedAt?: string | null): number {
  const end = endedAt ? Date.parse(endedAt) : now
  return Math.max(0, Math.floor((end - Date.parse(openedAt)) / 1000))
}

/** `m:ss`, or `h:mm:ss` from an hour on. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** A MEDIA_STATE message → the peer's flags (anything missing is "off"). */
export function peerMedia(message: Record<string, unknown>): PeerMedia {
  return { audio: message.audio === true, video: message.video === true, screen: message.screen === true }
}

export const MAX_CHAT = 2000

/** The text a chat box may send: trimmed, non-empty, within the server's limit — else null. */
export function chatText(raw: string): string | null {
  const text = raw.trim()
  return text && text.length <= MAX_CHAT ? text : null
}
