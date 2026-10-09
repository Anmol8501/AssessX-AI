/**
 * The rolling pre-event buffer for evidence clips (PRD FR-017; docs/EVIDENCE-CLIPS.md).
 *
 * **Why overlapping segments.** A WebM `MediaRecorder` stream is only playable from its beginning, so
 * the last N seconds cannot be cut out of one long recording. Instead a new, self-contained recorder
 * starts every `pre_seconds`. When a qualifying event happens, the newest segment that began at least
 * `pre_seconds` earlier keeps recording until `post_seconds` after the event, and becomes the clip: it
 * holds between `pre` and `2 × pre` seconds before the event, then the event, then `post` seconds.
 * Every other segment is dropped as soon as it is too old to serve as a pre-event buffer.
 *
 * **Bounded.** At most `ceil((pre + period) / period) + 1` segments (≈3) exist at once, each in memory
 * only, each stopped at the clip's byte ceiling. Nothing touches the disk and nothing is uploaded here:
 * the caller uploads one finished clip, for an event the server accepted.
 *
 * **Privacy.** Video only — the camera track is cloned, scaled down and rate-limited for recording; no
 * microphone track is ever added. The original track (live view, AI) is never touched or stopped.
 */
import type { RecordingPolicy } from '@/features/assessments/types'

export interface RecorderLike {
  state: 'inactive' | 'recording' | 'paused'
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  onerror: (() => void) | null
  start(timeslice?: number): void
  stop(): void
}

export type RecorderFactory = (stream: MediaStream, options: { mimeType: string; videoBitsPerSecond: number }) => RecorderLike

export interface CapturedClip {
  blob: Blob
  durationMs: number
}

/** Why a capture could not produce a clip. Mirrors the server's client failure reasons. */
export type CaptureFailure = 'recorder_unavailable' | 'recording_failed' | 'too_large'

export class CaptureError extends Error {
  readonly reason: CaptureFailure
  constructor(reason: CaptureFailure) {
    super(reason)
    this.reason = reason
  }
}

interface Segment {
  recorder: RecorderLike
  startedAt: number
  chunks: Blob[]
  bytes: number
  reserved: boolean
  failed: boolean
}

const MIME_TYPES = ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']
/** Recorders emit data every second, so a stopped segment never loses more than that. */
const TIMESLICE_MS = 1000

export function supportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

const defaultFactory: RecorderFactory = (stream, options) => new MediaRecorder(stream, options) as unknown as RecorderLike

export interface RollingRecorderOptions {
  policy: RecordingPolicy
  /** The stream to record (already reduced to one video track). */
  stream: MediaStream
  mimeType: string
  factory?: RecorderFactory
  now?: () => number
}

export class RollingRecorder {
  private readonly policy: RecordingPolicy
  private readonly stream: MediaStream
  private readonly mimeType: string
  private readonly factory: RecorderFactory
  private readonly now: () => number
  private segments: Segment[] = []
  private rotation: ReturnType<typeof setInterval> | null = null
  private active: { promise: Promise<CapturedClip>; finish: () => void } | null = null
  private stopped = false

  constructor(options: RollingRecorderOptions) {
    this.policy = options.policy
    this.stream = options.stream
    this.mimeType = options.mimeType
    this.factory = options.factory ?? defaultFactory
    this.now = options.now ?? (() => Date.now())
  }

  private get periodMs() {
    return this.policy.pre_seconds * 1000
  }

  start(): void {
    if (this.rotation !== null || this.stopped) return
    this.startSegment()
    this.rotation = setInterval(() => this.rotate(), this.periodMs)
  }

  /** Number of segments currently held (for tests and diagnostics). */
  get segmentCount(): number {
    return this.segments.length
  }

  private startSegment(): void {
    let recorder: RecorderLike
    try {
      recorder = this.factory(this.stream, { mimeType: this.mimeType, videoBitsPerSecond: this.policy.video_bits_per_second })
    } catch {
      return // the camera may be gone; the next rotation tries again
    }
    const segment: Segment = { recorder, startedAt: this.now(), chunks: [], bytes: 0, reserved: false, failed: false }
    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return
      segment.chunks.push(event.data)
      segment.bytes += event.data.size
      // A segment never grows past the clip ceiling: a reserved one is finished early, any other dropped.
      if (segment.bytes > this.policy.max_clip_bytes) {
        if (segment.reserved) this.active?.finish()
        else this.drop(segment)
      }
    }
    recorder.onerror = () => {
      segment.failed = true
      if (segment.reserved) this.active?.finish()
      else this.drop(segment)
    }
    try {
      recorder.start(TIMESLICE_MS)
    } catch {
      return
    }
    this.segments.push(segment)
  }

  private drop(segment: Segment): void {
    this.segments = this.segments.filter((s) => s !== segment)
    segment.chunks = []
    try {
      if (segment.recorder.state !== 'inactive') segment.recorder.stop()
    } catch {
      /* already stopped */
    }
  }

  /** Starts the next segment and drops those too old to be anyone's pre-event buffer. */
  private rotate(): void {
    if (this.stopped) return
    this.startSegment()
    const oldest = this.now() - (this.policy.pre_seconds * 1000 + this.periodMs) - TIMESLICE_MS
    for (const segment of [...this.segments]) {
      if (!segment.reserved && segment.startedAt < oldest) this.drop(segment)
    }
  }

  /**
   * Captures a clip around "now". An event while a capture is still recording is covered by that same
   * clip, so it returns the same promise (the server links such events to one clip, too). Null when
   * there is nothing to record from.
   */
  capture(): Promise<CapturedClip> | null {
    if (this.stopped) return null
    if (this.active) return this.active.promise
    const now = this.now()
    const usable = this.segments.filter((s) => !s.failed)
    if (usable.length === 0) return null
    // The newest segment that already holds `pre` seconds; else (just started) the oldest there is.
    const preMs = this.policy.pre_seconds * 1000
    const segment = [...usable].reverse().find((s) => now - s.startedAt >= preMs) ?? usable[0]!
    segment.reserved = true

    let finish: () => void = () => {}
    const promise = new Promise<CapturedClip>((resolve, reject) => {
      let done = false
      const timer = setTimeout(() => finish(), this.policy.post_seconds * 1000)
      finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        const recorder = segment.recorder
        const complete = () => {
          this.segments = this.segments.filter((s) => s !== segment)
          this.active = null
          const blob = new Blob(segment.chunks, { type: 'video/webm' })
          const durationMs = Math.min(this.now() - segment.startedAt, this.policy.max_clip_seconds * 1000)
          segment.chunks = []
          if (segment.failed && blob.size === 0) reject(new CaptureError('recording_failed'))
          else if (blob.size === 0) reject(new CaptureError('recording_failed'))
          else if (blob.size > this.policy.max_clip_bytes) reject(new CaptureError('too_large'))
          else resolve({ blob, durationMs })
        }
        if (recorder.state === 'inactive') {
          complete()
          return
        }
        recorder.onstop = complete // the final chunk arrives before `stop`
        try {
          recorder.stop()
        } catch {
          complete()
        }
      }
    })
    this.active = { promise, finish: () => finish() }
    return promise
  }

  /**
   * Stops everything (the exam ended, the camera went away). A capture in progress is finished with
   * what it has, so a clip whose window straddled the end is not lost; no new capture can start.
   */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.rotation !== null) clearInterval(this.rotation)
    this.rotation = null
    this.active?.finish()
    for (const segment of [...this.segments]) if (!segment.reserved) this.drop(segment)
  }
}

/**
 * The stream to record: a clone of the camera's video track, scaled down and rate-limited for
 * recording. Stopping it never affects the original track.
 */
export async function recordingStream(camera: MediaStream, policy: RecordingPolicy): Promise<MediaStream | null> {
  const track = camera.getVideoTracks()[0]
  if (!track || track.readyState !== 'live') return null
  const clone = track.clone()
  try {
    await clone.applyConstraints({
      width: { max: policy.max_width },
      height: { max: policy.max_height },
      frameRate: { max: policy.frame_rate },
    })
  } catch {
    // Not every camera can rescale; the bitrate cap still bounds the clip's size.
  }
  return new MediaStream([clone])
}
