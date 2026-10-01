import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { CameraIcon, MicIcon } from '@/components/icons'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { elapsedSeconds, formatElapsed, MAX_CHAT } from './callLogic'
import type { CallPhase, LiveCall } from './useCall'
import type { CallRole, ChatMessage } from './types'

/**
 * The live call screen shared by both sides (Phase 7D): the other person large (or their shared screen,
 * with them beside it), this person's own preview, the controls, the timer and a side panel (chat; the
 * interviewer adds the question guide and notes). Nothing on this screen records anything.
 */

const PHASE: Record<CallPhase, string> = {
  connecting: 'Connecting…',
  waiting: 'Waiting for the other person to join',
  negotiating: 'Connecting video…',
  connected: 'Connected',
  reconnecting: 'Connection lost — reconnecting…',
  ended: 'The call has ended',
  unavailable: 'This call is not available',
  occupied: 'Someone else is already in this call',
}

function phaseLabel(phase: CallPhase): string {
  return PHASE[phase]
}

export function VideoTile({
  stream,
  muted,
  label,
  off,
  mirrored,
  fit = 'cover',
  className,
}: {
  stream: MediaStream | null
  muted?: boolean
  label: string
  /** Show the placeholder instead of the picture (camera off, or nothing to show). */
  off?: boolean
  mirrored?: boolean
  fit?: 'cover' | 'contain'
  className?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const video = ref.current
    if (!video || video.srcObject === stream) return
    video.srcObject = stream
    // Joining was a click, so playback with sound is allowed; a refusal leaves the tile as it is.
    if (stream) void video.play().catch(() => undefined)
  }, [stream])
  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-gray-900', className)}>
      {/* Kept mounted while "off", so the other side's audio keeps playing. */}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        aria-label={label}
        className={cn('h-full w-full', fit === 'cover' ? 'object-cover' : 'object-contain', mirrored && '-scale-x-100', (off || !stream) && 'invisible')}
      />
      {(off || !stream) && (
        <div className="absolute inset-0 flex items-center justify-center text-[13px] text-gray-400">{stream ? 'Camera off' : 'No video'}</div>
      )}
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[12px] text-white">{label}</span>
    </div>
  )
}

export function CallTimer({ openedAt, endedAt, plannedMinutes }: { openedAt: string; endedAt?: string | null; plannedMinutes: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (endedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [endedAt])
  const seconds = elapsedSeconds(openedAt, now, endedAt)
  return (
    <span className={cn('font-mono text-[13px] tabular-nums', seconds > plannedMinutes * 60 ? 'text-amber-300' : 'text-gray-200')} aria-label="Call time">
      {formatElapsed(seconds)} <span className="text-gray-400">/ {plannedMinutes} min</span>
    </span>
  )
}

export function ChatPanel({
  messages,
  role,
  onSend,
  disabled,
}: {
  messages: ChatMessage[]
  role: CallRole
  onSend?(body: string): boolean
  disabled?: boolean
}) {
  const [text, setText] = useState('')
  const [failed, setFailed] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length])
  const mine = role === 'interviewer' ? 'INTERVIEWER' : 'CANDIDATE'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!onSend) return
    const sent = onSend(text)
    setFailed(!sent)
    if (sent) setText('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" role="log" aria-label="Chat history">
        {messages.length === 0 && <p className="text-[12.5px] text-gray-400">No messages yet.</p>}
        {messages.map((m) => (
          <div key={m.message_id} className={cn('max-w-[85%] rounded-lg px-3 py-1.5 text-[13px]', m.sender_role === mine ? 'ml-auto bg-blue-600 text-white' : 'bg-gray-800 text-gray-100')}>
            <p className="text-[11px] opacity-70">
              {m.sender.name} · {new Date(m.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="break-words whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      {onSend && (
        <form onSubmit={submit} className="flex gap-2 border-t border-gray-800 p-3">
          <input
            aria-label="Chat message"
            className="h-9 min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 text-[13px] text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
            placeholder="Type a message"
            maxLength={MAX_CHAT}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={disabled || !text.trim()}>
            Send
          </Button>
        </form>
      )}
      {failed && <p className="px-3 pb-2 text-[12px] text-amber-300">Not sent — the connection is down. Try again.</p>}
    </div>
  )
}

function Toggle({ on, onClick, label, children }: { on: boolean; onClick(): void; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors',
        on ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-red-600 text-white hover:bg-red-500',
      )}
    >
      {children}
    </button>
  )
}

/** The whole call: stage, own preview, controls and side panel. */
export function CallScreen({
  call,
  role,
  title,
  subtitle,
  openedAt,
  plannedMinutes,
  peerName,
  panel,
  endControl,
}: {
  call: LiveCall
  role: CallRole
  title: string
  subtitle: string
  openedAt: string
  plannedMinutes: number
  peerName: string
  /** The side panel (chat; plus the guide and notes for the interviewer). */
  panel: ReactNode
  /** "End call" for the interviewer, "Leave" for the candidate. */
  endControl: ReactNode
}) {
  const peerSharing = !!call.peer?.screen && !!call.remoteScreen
  const peerCameraOff = call.peer ? !call.peer.video : false
  const hasAudio = !!call.localStream?.getAudioTracks().length
  const hasVideo = !!call.localStream?.getVideoTracks().length

  return (
    <div className="flex h-full w-full flex-col bg-gray-950 text-white" data-testid="live-call" data-role={role} data-phase={call.phase}>
      <header className="flex items-center justify-between gap-4 border-b border-gray-800 px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold">{title}</p>
          <p className="truncate text-[12px] text-gray-400">{subtitle}</p>
        </div>
        <div className="flex items-center gap-4">
          <span role="status" className={cn('text-[12.5px]', call.phase === 'connected' ? 'text-emerald-400' : 'text-gray-300')}>
            {phaseLabel(call.phase)}
          </span>
          <CallTimer openedAt={openedAt} plannedMinutes={plannedMinutes} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative flex min-w-0 flex-1 flex-col gap-3 p-3">
          {call.mediaError && (
            <p className="rounded-md bg-amber-500/15 px-3 py-1.5 text-[12.5px] text-amber-200" role="alert">
              {call.mediaError}
            </p>
          )}
          <div className="flex min-h-0 flex-1 gap-3">
            {peerSharing && <VideoTile stream={call.remoteScreen} muted label={`${peerName}’s screen`} fit="contain" className="min-w-0 flex-[3]" />}
            <VideoTile
              stream={call.peerPresent ? call.remoteStream : null}
              label={call.peer && !call.peer.audio ? `${peerName} (muted)` : peerName}
              off={peerCameraOff}
              className={peerSharing ? 'min-w-0 flex-1 self-start aspect-video' : 'min-w-0 flex-1'}
            />
          </div>
          <div className="absolute right-6 bottom-20 flex w-56 flex-col gap-2">
            {call.localScreen && <VideoTile stream={call.localScreen} muted label="Your screen (shared)" fit="contain" className="aspect-video" />}
            <VideoTile stream={call.localStream} muted mirrored label="You" off={!call.video || !hasVideo} className="aspect-video shadow-lg ring-1 ring-gray-700" />
          </div>
          <div className="flex items-center justify-center gap-3 pt-1" role="toolbar" aria-label="Call controls">
            <Toggle on={call.audio && hasAudio} onClick={call.toggleAudio} label={call.audio ? 'Mute microphone' : 'Unmute microphone'}>
              <MicIcon />
              {call.audio && hasAudio ? 'Mute' : 'Unmute'}
            </Toggle>
            <Toggle on={call.video && hasVideo} onClick={call.toggleVideo} label={call.video ? 'Turn camera off' : 'Turn camera on'}>
              <CameraIcon />
              {call.video && hasVideo ? 'Camera' : 'Camera off'}
            </Toggle>
            <button
              type="button"
              onClick={() => void call.toggleScreen()}
              aria-pressed={call.sharing}
              className={cn(
                'h-11 rounded-full px-4 text-[13px] font-medium transition-colors',
                call.sharing ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-gray-700 text-white hover:bg-gray-600',
              )}
            >
              {call.sharing ? 'Stop sharing' : 'Share screen'}
            </button>
            {endControl}
          </div>
        </main>
        <aside className="flex w-80 shrink-0 flex-col border-l border-gray-800" aria-label="Call panel">
          {panel}
        </aside>
      </div>
    </div>
  )
}

/** A dark full-screen message (call unavailable, ended, loading). */
export function CallMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-gray-950 p-8 text-white">
      <div className="max-w-md space-y-3 text-center">
        <p className="text-[16px] font-semibold" role="status">
          {title}
        </p>
        {children}
      </div>
    </div>
  )
}
