import type { BoundingBox } from '../types'

/**
 * Short-lived face tracking (Phase 5B.3): links a face box in one sampled frame to the same face in
 * the next, so later phases can treat consecutive detections as one continuous observation.
 *
 * **Not identity.** A track id (`t1`, `t2`, …) only means "the box that overlapped the previous
 * box"; it carries no biometric information, is never stored, and is discarded when the track ends,
 * the camera changes, or the exam ends (`reset()`). The same person reappearing gets a new id.
 *
 * Association is greedy highest-overlap (IoU) matching. Its two parameters are provisional
 * (UNRESOLVED — requires Phase 5 technical decision): the minimum overlap to continue a track, and
 * how many consecutive sampled frames a face may be missing before its track ends.
 */
export interface TrackerOptions {
  minIoU: number
  maxMissedFrames: number
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = { minIoU: 0.3, maxMissedFrames: 2 }

export interface Track {
  trackId: string
  box: BoundingBox
  score: number | null
  /** Monotonic time (ms) of the frame that started the track. */
  startedAt: number
  /** Sampled frames in which the face was matched, including the first. */
  framesSeen: number
  /** Consecutive sampled frames without a match (0 while visible). */
  missed: number
}

export function iou(a: BoundingBox, b: BoundingBox): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top)
  const union = a.width * a.height + b.width * b.height - intersection
  return union > 0 ? intersection / union : 0
}

export class FaceTracker {
  private tracks: Track[] = []
  private nextId = 1
  private readonly options: TrackerOptions

  constructor(options: TrackerOptions = DEFAULT_TRACKER_OPTIONS) {
    this.options = options
  }

  /** Associates this frame's faces with existing tracks and returns the tracks visible in it. */
  update(faces: { box: BoundingBox; score: number | null }[], timestamp: number): Track[] {
    const pairs: { track: number; face: number; overlap: number }[] = []
    this.tracks.forEach((track, trackIndex) => {
      faces.forEach((face, faceIndex) => {
        const overlap = iou(track.box, face.box)
        if (overlap >= this.options.minIoU) pairs.push({ track: trackIndex, face: faceIndex, overlap })
      })
    })
    pairs.sort((a, b) => b.overlap - a.overlap)

    const matchedTracks = new Set<number>()
    const matchedFaces = new Set<number>()
    for (const pair of pairs) {
      if (matchedTracks.has(pair.track) || matchedFaces.has(pair.face)) continue
      matchedTracks.add(pair.track)
      matchedFaces.add(pair.face)
      const track = this.tracks[pair.track]!
      const face = faces[pair.face]!
      track.box = face.box
      track.score = face.score
      track.framesSeen++
      track.missed = 0
    }

    this.tracks.forEach((track, index) => {
      if (!matchedTracks.has(index)) track.missed++
    })
    this.tracks = this.tracks.filter((track) => track.missed <= this.options.maxMissedFrames)

    faces.forEach((face, index) => {
      if (matchedFaces.has(index)) return
      this.tracks.push({
        trackId: `t${this.nextId++}`,
        box: face.box,
        score: face.score,
        startedAt: timestamp,
        framesSeen: 1,
        missed: 0,
      })
    })

    return this.tracks.filter((track) => track.missed === 0).map((track) => ({ ...track, box: { ...track.box } }))
  }

  /** Forgets every track and restarts ids. */
  reset(): void {
    this.tracks = []
    this.nextId = 1
  }

  get size(): number {
    return this.tracks.length
  }
}
