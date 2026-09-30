import type { Frame } from './types'

/** What the pipeline needs from a frame source. `FrameProvider` is the camera implementation. */
export interface FrameSource {
  start(): Promise<void>
  capture(): Promise<Frame | null>
  stop(): void
}

/**
 * Acquires frames from the **existing** candidate camera stream for the AI pipeline (plan 5A.1).
 *
 * It never calls `getUserMedia`: it is handed the very `MediaStream` the proctoring check already
 * opened (`useMediaDevice`), the same one the Phase 4C WebRTC publisher reuses, and only attaches a
 * hidden `<video>` element to read frames from it. There is exactly one camera acquisition path in
 * AssessX; this is a second *consumer* of it, not a second capture.
 *
 * Each `capture()` decodes the current video frame into an `ImageBitmap`. The caller owns the
 * returned `Frame` and must `close()` it; the pipeline does so immediately after inference, so
 * pixels are used and discarded — never stored, uploaded or logged (privacy: KB §42, plan 5A.5).
 */
export class FrameProvider implements FrameSource {
  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private nextId = 0
  private started = false

  constructor(stream: MediaStream) {
    this.stream = stream
  }

  /** Attaches the stream to a hidden video element and waits for it to produce pixels. */
  async start(): Promise<void> {
    if (this.started || !this.stream) return
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.setAttribute('aria-hidden', 'true')
    // Kept out of the layout and off screen readers; it exists only as a frame source.
    video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9999px;'
    video.srcObject = this.stream
    document.body.appendChild(video)
    this.video = video
    try {
      await video.play()
    } catch {
      // Autoplay of a muted local stream is normally allowed; if it is refused the first
      // `capture()` calls simply report the frame as unavailable and health reflects it.
    }
    this.started = true
  }

  /** True while the video is producing frames from a live track. */
  get available(): boolean {
    const video = this.video
    const track = this.stream?.getVideoTracks()[0]
    return (
      this.started &&
      video !== null &&
      track !== undefined &&
      track.readyState === 'live' &&
      video.readyState >= 2 && // HAVE_CURRENT_DATA
      video.videoWidth > 0
    )
  }

  /**
   * Decodes the current frame, or returns `null` when none is ready (still opening, disconnected,
   * or the bitmap could not be created). Never throws.
   */
  async capture(): Promise<Frame | null> {
    const video = this.video
    if (!this.available || !video) return null
    let bitmap: ImageBitmap | null = null
    try {
      bitmap = typeof createImageBitmap === 'function' ? await createImageBitmap(video) : null
    } catch {
      bitmap = null // a transient decode failure is reported as an unavailable frame, not a crash
    }
    const width = bitmap?.width ?? video.videoWidth
    const height = bitmap?.height ?? video.videoHeight
    if (width === 0 || height === 0) {
      bitmap?.close()
      return null
    }
    let closed = false
    return {
      frameId: this.nextId++,
      monotonicTs: performance.now(),
      wallClock: new Date().toISOString(),
      width,
      height,
      bitmap,
      close() {
        if (closed) return
        closed = true
        bitmap?.close()
        bitmap = null
      },
    }
  }

  /** Detaches and removes the video element and drops the stream reference. Idempotent. */
  stop(): void {
    const video = this.video
    if (video) {
      video.pause()
      video.srcObject = null
      video.remove()
    }
    this.video = null
    this.stream = null
    this.started = false
  }
}
