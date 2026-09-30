import { useEffect, useRef, useState } from 'react'
import type { MediaDevice } from '../useMediaDevice'
import { DEFAULT_AI_CONFIG } from './config'
import { AIEventProcessor, type OpenEpisode, type Report } from './events'
import { AIPipeline } from './pipeline'
import { eventConfig, publishEventDiagnostics, publishState, selectComponents } from './seam'
import type { AIPipelineView } from './types'

const INITIAL_VIEW: AIPipelineView = {
  health: { state: 'INITIALIZING', reason: null, cameraAvailable: false, runtimeState: 'UNINITIALIZED', detectors: [] },
  telemetry: {
    framesCaptured: 0,
    framesProcessed: 0,
    framesDropped: 0,
    framesUnavailable: 0,
    lastLatencyMs: null,
    avgLatencyMs: null,
    processedFps: null,
    runtimeLoadMs: null,
    startedAt: null,
    runtime: null,
    lastStageTimingsMs: null,
  },
  recentObservations: [],
}

/**
 * Runs the Phase 5A AI perception pipeline for one proctored attempt, tied to the proctoring
 * session's lifecycle (plan 5A, prompt §21).
 *
 * It starts when this hook mounts inside the active proctored exam and stops — releasing the frame
 * provider, scheduler, detectors and runtime — when the exam ends or the component unmounts. It
 * reuses the proctoring camera stream (`useMediaDevice`) and never opens its own; when that camera
 * drops or returns, the pipeline is pointed at the new stream. The returned view drives the
 * candidate's technical AI-status indicator, and is mirrored onto the test seam for E2E assertions.
 *
 * In the packaged app the runtime is MediaPipe (Phase 5B) running in a Web Worker, with the face,
 * tracking, head-pose, gaze, phone and frame-quality detectors.
 *
 * Phase 5C: when given the session's event `report` function, the hook also runs the
 * `AIEventProcessor`, which turns each processed frame's observations into debounced episode
 * events (started → resolved) and reports changes of AI health as `AI_STATUS`. The processor is
 * the only place observations become events; it stops — closing any open episode as
 * `monitoring_stopped` — when the pipeline stops. Open episode ids are kept in local storage so a
 * restarted app can close the ones its previous run left open.
 */
export function useAIPipeline(attemptId: string, camera: MediaDevice, report?: Report): AIPipelineView {
  const [view, setView] = useState<AIPipelineView>(INITIAL_VIEW)
  const pipelineRef = useRef<AIPipeline | null>(null)
  const cameraStream = camera.stream
  // The current stream, kept in a ref so the start effect (keyed on the attempt only) can read the
  // latest without re-running. Written in an effect, never during render.
  const streamRef = useRef<MediaStream | null>(cameraStream)
  // The latest reporter, read by the processor at report time (the start effect is keyed on the attempt).
  const reportRef = useRef<Report | undefined>(report)
  const reports = report !== undefined

  useEffect(() => {
    reportRef.current = report
  }, [report])

  useEffect(() => {
    const { runtime, detectors, config } = selectComponents()
    const pipeline = new AIPipeline({ runtime, detectors }, { ...DEFAULT_AI_CONFIG, ...config })
    pipelineRef.current = pipeline

    let processor: AIEventProcessor | null = null
    let unsubscribeFrames = () => {}
    let timer: number | null = null
    if (reports) {
      const events = eventConfig()
      const active = new AIEventProcessor({
        report: (eventType, metadata) => reportRef.current?.(eventType, metadata),
        config: events,
        onOpenEpisodesChanged: (open) => saveOpenEpisodes(attemptId, open),
      })
      active.closeLeftovers(loadOpenEpisodes(attemptId))
      saveOpenEpisodes(attemptId, [])
      unsubscribeFrames = pipeline.subscribeFrames((frame) => {
        active.observeFrame(frame.observations, frame.monotonicTs)
        publishEventDiagnostics(active.diagnostics())
      })
      timer = window.setInterval(() => active.tick(), events.tickMs)
      processor = active
    }

    const unsubscribe = pipeline.subscribe((next) => {
      // Only the current pipeline speaks. A pipeline being stopped (e.g. React StrictMode's dev
      // mount/unmount/remount) can emit late while its successor is already running; that stale
      // view must not overwrite the live one. After a real unmount there is no successor (the ref is
      // null), so its final STOPPED state is still delivered.
      if (pipelineRef.current !== pipeline && pipelineRef.current !== null) return
      setView(next)
      publishState(next)
      processor?.observeHealth(next)
    })
    void pipeline.start(streamRef.current)
    return () => {
      pipelineRef.current = null
      if (timer !== null) window.clearInterval(timer)
      unsubscribeFrames()
      processor?.stop()
      // Keep the subscription alive until stop() has fully run, so its final STOPPED state is still
      // delivered (and mirrored to the seam) before we detach.
      void pipeline.stop().finally(unsubscribe)
    }
    // Keyed on the attempt only: the stream is fed through the effect below so a camera reconnect
    // never tears down and reloads the whole pipeline.
  }, [attemptId, reports])

  useEffect(() => {
    streamRef.current = cameraStream
    pipelineRef.current?.setStream(cameraStream)
  }, [cameraStream])

  return view
}

function openEpisodesKey(attemptId: string) {
  return `assessx.ai-open-episodes.${attemptId}`
}

function loadOpenEpisodes(attemptId: string): OpenEpisode[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(openEpisodesKey(attemptId)) ?? '[]')
    return Array.isArray(parsed) ? (parsed as OpenEpisode[]) : []
  } catch {
    return []
  }
}

function saveOpenEpisodes(attemptId: string, open: OpenEpisode[]) {
  try {
    if (open.length === 0) localStorage.removeItem(openEpisodesKey(attemptId))
    else localStorage.setItem(openEpisodesKey(attemptId), JSON.stringify(open))
  } catch {
    // Storage unavailable: the server still closes open episodes when the session ends.
  }
}
