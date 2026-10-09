import { useEffect, useState } from 'react'
import { CameraIcon } from '@/components/icons'
import { Button, StatusBadge } from '@/components/ui'
import { describeError } from '@/features/assessments/useAssessments'
import { tokenStorage, useApi, useSession } from '@/features/session'
import { ApiError, apiBlob } from '@/lib/api'
import { eventTypeLabel } from '../monitoring/events'
import { SOURCE_LABEL, clipDuration, clipStatusLabel, clipTitle, clipUnavailableReason, toClipDetail, type EvidenceClipDetail } from './clips'
import { clock } from './labels'

type Video = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string }

function videoError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'evidence_integrity_failed') return 'This clip failed its integrity check and cannot be shown. The failure has been recorded.'
    if (error.code === 'evidence_unavailable') return 'The video has been deleted. Its record remains.'
    if (error.code === 'evidence_not_ready') return 'There is no video for this clip yet.'
  }
  return describeError(error, 'The video could not be loaded.')
}

/**
 * One evidence clip in the admin review (FR-017): what it covers and, on request, the video.
 *
 * The video is fetched from the API with the administrator's own session — the server checks who is
 * asking and the clip's SHA-256 first, and records the view — then played from memory through a
 * `blob:` URL that is revoked when the panel closes. No storage address ever reaches this app.
 * The wording is factual: the clip shows a moment around an observed event; a person decides.
 */
export function EvidenceClipPanel({ attemptId, clipId }: { attemptId: string; clipId: string }) {
  const api = useApi()
  const { expire } = useSession()
  const [detail, setDetail] = useState<EvidenceClipDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [video, setVideo] = useState<Video>({ status: 'idle' })
  const base = `/api/v1/admin/attempts/${attemptId}/evidence-clips/${clipId}`

  useEffect(() => {
    const controller = new AbortController()
    api<Record<string, unknown>>(base, { signal: controller.signal })
      .then((raw) => !controller.signal.aborted && setDetail(toClipDetail(raw)))
      .catch((error: unknown) => !controller.signal.aborted && setLoadError(describeError(error, 'Could not load this clip.')))
    return () => controller.abort()
  }, [api, base])

  // The in-memory video is released when the panel closes or another clip is shown.
  useEffect(
    () => () => {
      if (video.status === 'ready') URL.revokeObjectURL(video.url)
    },
    [video],
  )

  async function watch() {
    setVideo({ status: 'loading' })
    try {
      const blob = await apiBlob(`${base}/media`, { token: tokenStorage.get() })
      setVideo({ status: 'ready', url: URL.createObjectURL(blob) })
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthorized) expire()
      setVideo({ status: 'error', message: videoError(error) })
    }
  }

  if (loadError) return <p className="text-danger text-[12px]">{loadError}</p>
  if (!detail) return <p className="text-ink-subtle text-[12px]">Loading the evidence clip…</p>

  const trigger = detail.events.find((e) => e.trigger) ?? detail.events[0]
  const others = detail.events.filter((e) => !e.trigger)
  const status = clipStatusLabel(detail.status)

  return (
    <div className="border-line bg-surface mt-1 space-y-1.5 rounded-md border p-2.5" data-evidence="clip">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-ink flex items-center gap-1.5 text-[12.5px] font-medium">
          <CameraIcon className="text-[14px]" aria-hidden="true" />
          {trigger ? clipTitle(trigger.eventType) : 'Evidence clip'}
        </p>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>
      <p className="text-ink-subtle text-[11.5px]">
        {SOURCE_LABEL[detail.sourceType]} · around {clock(detail.eventAt)} ({clock(detail.windowStartsAt)}–{clock(detail.windowEndsAt)}) ·{' '}
        {detail.hasVideo ? clipDuration(detail.durationMs) : 'no video'}
        {detail.hasVideo && detail.retainUntil ? ` · kept until ${new Date(detail.retainUntil).toLocaleDateString()}` : ''}
      </p>
      {others.length > 0 && (
        <p className="text-ink-subtle text-[11.5px]" data-evidence="clip-events">
          This clip also covers: {others.map((e) => `${eventTypeLabel(e.eventType)} (${clock(e.recordedAt)})`).join('; ')}
        </p>
      )}
      {!detail.hasVideo && <p className="text-ink-subtle text-[11.5px]">{clipUnavailableReason(detail)}</p>}
      {detail.hasVideo && video.status !== 'ready' && (
        <Button size="sm" variant="secondary" onClick={() => void watch()} loading={video.status === 'loading'}>
          View evidence
        </Button>
      )}
      {video.status === 'error' && (
        <p className="text-danger text-[11.5px]" role="alert">
          {video.message}
        </p>
      )}
      {video.status === 'ready' && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- a silent camera clip: there is no audio to caption
        <video src={video.url} controls autoPlay muted className="w-full max-w-md rounded-sm bg-black" aria-label={trigger ? clipTitle(trigger.eventType) : 'Evidence clip'} />
      )}
      <p className="text-ink-subtle text-[11px]">Supporting context recorded around an observed event. A person reviews it and decides.</p>
    </div>
  )
}
