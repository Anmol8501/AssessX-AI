import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { routes } from '@/app/routes'
import { describeError } from '@/features/assessments/useAssessments'
import { ExamRunner } from '@/features/exam/ExamRunner'
import type { AttemptDetail, ExamDetail } from '@/features/exam/types'
import { ApiError } from '@/lib/api'
import { AIStatus, useAIPipeline } from './ai'
import { toServerState } from './devices'
import { DeviceReadiness } from './environment/DeviceReadiness'
import { CODING_OPENED_EVENT } from '@/features/coding/candidate/CodingWorkspace'
import { EnvironmentNotices } from './environment/EnvironmentNotices'
import { AIWarnings, HoldOverlay, ProctorMessageDialog, TabSwitchWarningDialog } from './environment/ExamControl'
import { useAIWarnings } from './environment/useAIWarnings'
import { useAttemptControl } from './environment/useAttemptControl'
import { useDeviceReadiness, type ReadinessEvent } from './environment/useDeviceReadiness'
import { useEnvironmentEnforcement } from './environment/useEnvironmentEnforcement'
import { useEventReporter } from './environment/useEventReporter'
import { useMediaPublisher } from './environment/useMediaPublisher'
import { Logo } from '@/components/Logo'
import { ProctoringCheck, type SessionCheck } from './ProctoringCheck'
import { ProctoringStatus } from './ProctoringStatus'
import { SecondaryCameraPairing } from './secondary/SecondaryCameraPairing'
import { useMediaDevice, type MediaDevice } from './useMediaDevice'
import { useProctoringApi, type DeviceReport } from './useProctoringApi'
import { supportedMimeType } from './evidence/rollingRecorder'
import { useEvidenceClips } from './evidence/useEvidenceClips'

interface ProctoredExamProps {
  exam: ExamDetail
  /** The attempt being resumed, or `null` when this check comes before starting one. */
  attempt: AttemptDetail | null
  /** Called with the attempt once it has been started and/or its session activated. */
  onAttempt(attempt: AttemptDetail): void
  /** Called with the finalized attempt when submission succeeds. */
  onFinished(attempt: AttemptDetail): void
  /** Called when the server says the attempt ended while the candidate was still working. */
  onStale(): void
}

/**
 * A proctored exam (Phase 4A): the readiness check, then the ordinary exam paper under proctoring.
 *
 *     readiness check ──► start attempt (if new) ──► activate session ──► exam ──► submit / timeout
 *
 * **The check comes before the clock.** For a new attempt the camera and microphone are confirmed
 * first and the attempt is started only when the candidate continues, so a slow permission prompt
 * or a retry never costs exam time. A resumed attempt's clock is already running, and says so.
 *
 * **The devices live exactly as long as this component.** The streams are opened here and handed
 * down; when the attempt finishes this component is replaced by the finished screen and every
 * track is stopped. Nothing from them is recorded or sent — only their availability, which is
 * reported to the server when it changes.
 *
 * **The server ends the session.** Submitting or running out of time ends it as part of
 * finalizing the attempt; there is no client call to end proctoring.
 *
 * **The exam environment is enforced only while the paper is on screen** (Phase 4B,
 * `EnforcedExam`): it engages once the session is active and is released the moment the exam
 * ends or the screen is left — the finished screen, the dashboard and the rest of Windows are
 * never locked.
 */
export function ProctoredExam({ exam, attempt, onAttempt, onFinished, onStale }: ProctoredExamProps) {
  const navigate = useNavigate()
  const camera = useMediaDevice('camera')
  const microphone = useMediaDevice('microphone')
  const readiness = useDeviceReadiness()
  const { startAttempt, activate, reportDevices } = useProctoringApi()

  const [entered, setEntered] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [stagedAttempt, setStagedAttempt] = useState<AttemptDetail | null>(attempt)
  const [primaryCheckDone, setPrimaryCheckDone] = useState(false)
  const [secondaryCameraStream, setSecondaryCameraStream] = useState<MediaStream | null>(null)
  const lastReported = useRef<string | null>(null)
  // Readiness runs before the session exists; its observations are held here and replayed into the
  // event log once the exam is entered (the session is active by then). `null` until the check
  // passes, so an unstarted readiness check is distinct from one that found nothing.
  const [readinessEvents, setReadinessEvents] = useState<ReadinessEvent[] | null>(null)
  const readinessPassed = readinessEvents !== null

  const report: DeviceReport = {
    camera: toServerState(camera.status),
    microphone: toServerState(microphone.status),
  }
  const reportKey = `${report.camera}/${report.microphone}`

  async function enter(explicitAttempt?: AttemptDetail | null) {
    setBusy(true)
    setSessionError(null)
    try {
      const current = explicitAttempt ?? stagedAttempt ?? attempt ?? (await startAttempt(exam.assessment_id))
      setStagedAttempt(current)
      if (current.proctoring === null) {
        // Started without proctoring after all (the setting was switched off in between): the
        // attempt is what decides, so go straight in.
        onAttempt(current)
        setEntered(true)
        return
      }
      // The server asks for evidence clips only from an app that says it can record them.
      const recording = current.proctoring?.recording ?? exam.recording
      const session = await activate(current.id, { ...report, evidence_recorder: Boolean(recording?.enabled && supportedMimeType()) })
      lastReported.current = reportKey
      onAttempt({ ...current, proctoring: session })
      setEntered(true)
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'attempt_locked') {
        onStale() // the attempt ended (e.g. its time ran out) while the check was open
        return
      }
      setSessionError(describeError(caught, 'Could not start the proctored exam. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function handlePrimaryContinue() {
    if (exam.secondary_camera_enabled) {
      setBusy(true)
      setSessionError(null)
      try {
        const cur = stagedAttempt ?? attempt ?? (await startAttempt(exam.assessment_id))
        setStagedAttempt(cur)
        setPrimaryCheckDone(true)
      } catch (caught) {
        setSessionError(describeError(caught, 'Could not initialize examination session for secondary camera.'))
      } finally {
        setBusy(false)
      }
    } else {
      void enter()
    }
  }

  // During the exam, tell the server when device availability changes (a camera unplugged or
  // reconnected). State only, and only on change — there is no stream or heartbeat here.
  const attemptId = attempt?.id ?? null
  const proctored = attempt?.proctoring != null
  useEffect(() => {
    if (!entered || !attemptId || !proctored) return
    if (camera.status === 'CHECKING' || microphone.status === 'CHECKING') return
    if (lastReported.current === reportKey) return
    const [cameraState, microphoneState] = reportKey.split('/') as [DeviceReport['camera'], DeviceReport['microphone']]
    lastReported.current = reportKey
    reportDevices(attemptId, { camera: cameraState, microphone: microphoneState }).catch((caught: unknown) => {
      if (caught instanceof ApiError && caught.code === 'attempt_locked') onStale()
      else lastReported.current = null // not recorded; the next change (or retry) sends it again
    })
  }, [entered, attemptId, proctored, reportKey, camera.status, microphone.status, reportDevices, onStale])

  // The device-readiness check comes first, before the camera/microphone check and before the
  // attempt is started, so a machine with prohibited apps open never begins the exam. It is skipped
  // where other applications cannot be inspected (a plain browser: status is `unsupported`).
  if (!entered && !readinessPassed && readiness.status !== 'unsupported') {
    return (
      <DeviceReadiness
        examTitle={exam.title}
        readiness={readiness}
        onContinue={() => setReadinessEvents(readiness.drainEvents())}
        onBack={() => navigate(routes.candidate.examDetail(exam.assessment_id))}
      />
    )
  }

  // Secondary camera pairing screen (Step 2 of proctoring check when enabled)
  if (!entered && exam.secondary_camera_enabled && primaryCheckDone && stagedAttempt) {
    return (
      <div className="bg-surface flex h-full w-full flex-col">
        <header className="border-line bg-card flex h-14 shrink-0 items-center gap-3 border-b px-6">
          <Logo size="sm" />
          <span className="bg-line h-5 w-px shrink-0" aria-hidden />
          <h1 className="text-ink truncate text-[14px] font-semibold">{exam.title}</h1>
        </header>

        <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-8 py-8">
          <div className="w-full max-w-3xl">
            <SecondaryCameraPairing
              attemptId={stagedAttempt.id}
              mandatory={exam.secondary_camera_mandatory}
              orientation={exam.secondary_camera_orientation}
              onVerified={(stream) => {
                setSecondaryCameraStream(stream)
                void enter(stagedAttempt)
              }}
              onCancel={() => setPrimaryCheckDone(false)}
            />
          </div>
        </div>
      </div>
    )
  }

  if (!entered || !stagedAttempt) {
    const session: SessionCheck = busy
      ? { status: 'working', detail: stagedAttempt ? 'Reconnecting to your exam…' : 'Starting your exam…' }
      : sessionError
        ? { status: 'error', detail: sessionError }
        : stagedAttempt
          ? { status: 'ready', detail: 'Your attempt is in progress and its clock is running.' }
          : { status: 'ready', detail: `${exam.duration_minutes} minutes, starting when you start the exam.` }

    return (
      <ProctoringCheck
        examTitle={exam.title}
        recording={stagedAttempt?.proctoring?.recording ?? exam.recording}
        camera={camera}
        microphone={microphone}
        session={session}
        resuming={stagedAttempt !== null}
        busy={busy}
        onContinue={() => void handlePrimaryContinue()}
        onBack={() => navigate(routes.candidate.examDetail(exam.assessment_id))}
      />
    )
  }

  const effectiveAttempt = stagedAttempt ?? attempt
  if (!proctored || !effectiveAttempt) {
    return <ExamRunner attempt={effectiveAttempt!} onFinished={onFinished} onStale={onStale} />
  }

  return (
    <EnforcedExam
      attempt={effectiveAttempt}
      initialEvents={readinessEvents ?? []}
      camera={camera}
      microphone={microphone}
      onFinished={onFinished}
      onStale={onStale}
    >
      <ProctoringStatus
        camera={camera}
        microphone={microphone}
        secondaryCameraStream={exam.secondary_camera_enabled ? secondaryCameraStream : undefined}
      />
    </EnforcedExam>
  )
}

/**
 * The exam paper under environment enforcement (Phase 4B). Mounting it engages the lockdown and
 * starts reporting events; unmounting it — the attempt finished, timed out, or the candidate left —
 * releases everything.
 */
function EnforcedExam({
  attempt,
  initialEvents,
  camera,
  microphone,
  onFinished,
  onStale,
  children,
}: {
  attempt: AttemptDetail
  /** Device-readiness observations from before the session was active, reported once on mount. */
  initialEvents: ReadinessEvent[]
  camera: MediaDevice
  microphone: MediaDevice
  onFinished(attempt: AttemptDetail): void
  onStale(): void
  children: ReactNode
}) {
  // Evidence clips (FR-017): a rolling buffer on the exam's camera; a clip only for a qualifying event
  // the server accepted. Video only, bounded, and stopped with the exam.
  const evidenceHooks = useEvidenceClips(attempt.id, camera.stream, attempt.proctoring?.recording)
  const report = useEventReporter(attempt.id, evidenceHooks)
  const { notices, fullscreenRequired, returnToFullscreen } = useEnvironmentEnforcement(report, undefined, {
    editorClipboard: attempt.coding_allow_paste,
  })
  // Phase 4C: publish this candidate's live camera/mic to a watching admin, reusing the streams
  // the proctoring check already opened. Released with this component when the exam ends.
  useMediaPublisher(attempt.id, camera, microphone)
  // Phase 5A/5B: the on-device AI perception pipeline runs on the same camera stream for the life of
  // the exam. Phase 5C: its observations become debounced, factual episode events (and AI health
  // becomes AI_STATUS) through the same reporter. Nothing here judges the candidate.
  // Exam rules: the candidate sees a plain instruction while the AI observes something. Warnings only.
  const aiWarnings = useAIWarnings(report)
  const ai = useAIPipeline(attempt.id, camera, aiWarnings.report)
  // Exam rules: the server counts tab switches and may put the exam on hold (locked).
  const { control, warning, dismissWarning, acknowledge } = useAttemptControl(attempt.id, attempt.control)
  const message = control.messages?.[0] ?? null

  // Coding activity: opening a problem is a fact on the timeline (runs and submissions are recorded by
  // the server itself).
  useEffect(() => {
    const onOpened = (event: Event) => {
      const number = (event as CustomEvent<{ questionNumber: number }>).detail?.questionNumber
      if (Number.isInteger(number) && number > 0) report('CODING_QUESTION_OPENED', { question_number: number })
    }
    window.addEventListener(CODING_OPENED_EVENT, onOpened)
    return () => window.removeEventListener(CODING_OPENED_EVENT, onOpened)
  }, [report])

  const replayed = useRef(false)
  useEffect(() => {
    if (replayed.current) return
    replayed.current = true
    for (const event of initialEvents) report(event.eventType, event.metadata)
  }, [initialEvents, report])

  return (
    <>
      <ExamRunner
        attempt={attempt}
        headerExtra={
          <div className="flex items-center gap-3">
            {children}
            <AIStatus health={ai.health} />
          </div>
        }
        onFinished={onFinished}
        onStale={onStale}
      />
      <EnvironmentNotices
        notices={notices}
        fullscreenRequired={fullscreenRequired && !control.on_hold}
        onReturnToFullscreen={() => void returnToFullscreen()}
      />
      {!control.on_hold && <AIWarnings conditions={aiWarnings.conditions} />}
      {warning && !control.on_hold && !fullscreenRequired && <TabSwitchWarningDialog warning={warning} onClose={dismissWarning} />}
      {control.on_hold && <HoldOverlay control={control} />}
      {message && !control.on_hold && <ProctorMessageDialog message={message} onAcknowledge={() => void acknowledge(message)} />}
    </>
  )
}
