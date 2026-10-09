import { useEffect, useMemo, useRef } from 'react'
import type { RecordingPolicy } from '@/features/assessments/types'
import { useApi } from '@/features/session'
import { ApiError } from '@/lib/api'
import type { ReporterHooks } from '../environment/useEventReporter'
import { EvidenceCoordinator, type ClientFailure } from './coordinator'
import { RollingRecorder, recordingStream, supportedMimeType, type CapturedClip } from './rollingRecorder'

const ME = '/api/v1/candidates/me'
const UPLOAD_RETRIES_MS = [2000, 5000]

/**
 * Evidence clips for one proctored attempt (FR-017): the rolling buffer on the exam's camera, and the
 * upload of a clip the server asked for. Returns the hooks the event reporter calls.
 *
 * Runs only while the exam is mounted, only with the server's policy switched on, and only on the
 * camera stream the exam already holds. Unmounting (submission, time up, sign-out) stops it: a capture
 * in progress finishes with what it has and may still be uploaded; nothing new is recorded.
 * Nothing here can stop the exam: every failure ends at a FAILED clip, never at an error on screen.
 */
export function useEvidenceClips(attemptId: string, camera: MediaStream | null, recording: RecordingPolicy | undefined): ReporterHooks {
  const api = useApi()
  // By value: the attempt is re-read during the exam, and a new object must not restart the recorder.
  const policyKey = recording ? JSON.stringify(recording) : ''
  const policy = useMemo(() => (policyKey ? (JSON.parse(policyKey) as RecordingPolicy) : undefined), [policyKey])
  const recorder = useRef<RollingRecorder | null>(null)
  const enabled = Boolean(policy?.enabled)

  useEffect(() => {
    if (!enabled || !policy || !camera) return
    const mimeType = supportedMimeType()
    if (!mimeType) return
    let cancelled = false
    let stream: MediaStream | null = null
    void recordingStream(camera, policy).then((recordable) => {
      if (cancelled || !recordable) {
        recordable?.getTracks().forEach((track) => track.stop())
        return
      }
      stream = recordable
      recorder.current = new RollingRecorder({ policy, stream: recordable, mimeType })
      recorder.current.start()
    })
    return () => {
      cancelled = true
      recorder.current?.stop()
      recorder.current = null
      // Let a finishing capture flush its last chunk before the cloned track ends (the camera's own
      // track is untouched).
      const ending = stream
      window.setTimeout(() => ending?.getTracks().forEach((track) => track.stop()), 1500)
    }
  }, [enabled, policy, camera, attemptId])

  const coordinator = useRef<EvidenceCoordinator | null>(null)
  useEffect(() => {
    if (!policy?.enabled) {
      coordinator.current = null
      return
    }
    const base = `${ME}/attempts/${attemptId}/proctoring/evidence-clips`
    const upload = async (clipId: string, clip: CapturedClip) => {
      const body = new Blob([clip.blob], { type: 'video/webm' })
      for (let attempt = 0; ; attempt++) {
        try {
          await api(`${base}/${clipId}?duration_ms=${Math.round(clip.durationMs)}`, { method: 'PUT', body })
          return
        } catch (error) {
          const retryable = !(error instanceof ApiError) || error.kind === 'network' || error.status === 503 || error.status === 429
          if (!retryable || attempt >= UPLOAD_RETRIES_MS.length) {
            // A refusal the server already recorded (too large, wrong type, closed) needs no report.
            if (error instanceof ApiError && error.kind === 'http' && error.status !== 503) return
            throw error
          }
          await new Promise((resolve) => window.setTimeout(resolve, UPLOAD_RETRIES_MS[attempt]))
        }
      }
    }
    const fail = async (clipId: string, reason: ClientFailure) => {
      await api(`${base}/${clipId}/failure`, { method: 'POST', body: { reason } })
    }
    coordinator.current = new EvidenceCoordinator({
      policy,
      capture: () => recorder.current?.capture() ?? null,
      upload,
      fail,
    })
    // Not cleared on unmount: a clip still being captured or uploaded finishes on its own.
  }, [api, attemptId, policy])

  return useMemo<ReporterHooks>(
    () => ({
      onQueued: (event) => coordinator.current?.queued(event),
      onRecorded: (event, recorded) => coordinator.current?.recorded(event, recorded),
    }),
    [],
  )
}
