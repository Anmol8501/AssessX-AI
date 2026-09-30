import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { routes } from '@/app/routes'
import { describeError } from '@/features/assessments/useAssessments'
import { ExamRunner } from '@/features/exam/ExamRunner'
import type { AttemptDetail, ExamDetail } from '@/features/exam/types'
import { ApiError } from '@/lib/api'
import { toServerState } from './devices'
import { DeviceReadiness } from './environment/DeviceReadiness'
import { EnvironmentNotices } from './environment/EnvironmentNotices'
import { useDeviceReadiness, type ReadinessEvent } from './environment/useDeviceReadiness'
import { useEnvironmentEnforcement } from './environment/useEnvironmentEnforcement'
import { useEventReporter } from './environment/useEventReporter'
import { useMediaPublisher } from './environment/useMediaPublisher'
import { ProctoringCheck, type SessionCheck } from './ProctoringCheck'
import { ProctoringStatus } from './ProctoringStatus'
import { useMediaDevice, type MediaDevice } from './useMediaDevice'
import { useProctoringApi, type DeviceReport } from './useProctoringApi'

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

  async function enter() {
    setBusy(true)
    setSessionError(null)
    try {
      const current = attempt ?? (await startAttempt(exam.assessment_id))
      if (current.proctoring === null) {
        // Started without proctoring after all (the setting was switched off in between): the
        // attempt is what decides, so go straight in.
        onAttempt(current)
        setEntered(true)
        return
      }
      const session = await activate(current.id, report)
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

  if (!entered || !attempt) {
    const session: SessionCheck = busy
      ? { status: 'working', detail: attempt ? 'Reconnecting to your exam…' : 'Starting your exam…' }
      : sessionError
        ? { status: 'error', detail: sessionError }
        : attempt
          ? { status: 'ready', detail: 'Your attempt is in progress and its clock is running.' }
          : { status: 'ready', detail: `${exam.duration_minutes} minutes, starting when you start the exam.` }

    return (
      <ProctoringCheck
        examTitle={exam.title}
        camera={camera}
        microphone={microphone}
        session={session}
        resuming={attempt !== null}
        busy={busy}
        onContinue={() => void enter()}
        onBack={() => navigate(routes.candidate.examDetail(exam.assessment_id))}
      />
    )
  }

  if (!proctored) {
    return <ExamRunner attempt={attempt} onFinished={onFinished} onStale={onStale} />
  }

  return (
    <EnforcedExam
      attempt={attempt}
      initialEvents={readinessEvents ?? []}
      camera={camera}
      microphone={microphone}
      onFinished={onFinished}
      onStale={onStale}
    >
      <ProctoringStatus camera={camera} microphone={microphone} />
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
  const report = useEventReporter(attempt.id)
  const { notices, fullscreenRequired, returnToFullscreen } = useEnvironmentEnforcement(report)
  // Phase 4C: publish this candidate's live camera/mic to a watching admin, reusing the streams
  // the proctoring check already opened. Released with this component when the exam ends.
  useMediaPublisher(attempt.id, camera, microphone)

  const replayed = useRef(false)
  useEffect(() => {
    if (replayed.current) return
    replayed.current = true
    for (const event of initialEvents) report(event.eventType, event.metadata)
  }, [initialEvents, report])

  return (
    <>
      <ExamRunner attempt={attempt} headerExtra={children} onFinished={onFinished} onStale={onStale} />
      <EnvironmentNotices
        notices={notices}
        fullscreenRequired={fullscreenRequired}
        onReturnToFullscreen={() => void returnToFullscreen()}
      />
    </>
  )
}
