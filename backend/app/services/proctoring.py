"""The proctoring session lifecycle (Phase 4A).

A proctoring session runs alongside a proctored exam attempt and follows it:

    attempt created ──► NOT_STARTED ──(devices confirmed)──► ACTIVE ──(attempt finalized)──► ENDED
                              └───────────(attempt finalized before confirmation)──────────────┘

The rules that shape this module:

* **The attempt stays in charge.** Phase 3's attempt lifecycle, clock, submission and evaluation
  are not changed or duplicated here. A session is created when a proctored attempt is created
  and ended when the attempt finalizes — both called from `services/attempts.py`, inside the same
  transaction, so an attempt can never be finished while its session still reads `ACTIVE`.
* **There is no "end session" request.** Ending proctoring early would let a candidate keep
  answering unproctored, so the only way a session ends is its attempt ending.
* **Ownership is resolved before this module is reached.** Every method takes an attempt that
  `AttemptService` has already scoped to the signed-in candidate (and, for writes, locked). This
  module never looks a session up by id from a request.
* **Device state is reported, not proven.** The desktop app opens the camera and microphone
  locally and reports whether it could. The server records that report with its own timestamp; it
  cannot verify it, and nothing here claims otherwise. No media reaches the server.
* **No judgement.** A device that goes missing is a state change that is logged, not a violation,
  and nothing here scores, flags or fails a candidate.

Phase 4B adds the event log (`services/proctoring_events.py`): the server records the session's
start, resumption and end and every device change as events, and the candidate's app reports what
it observes about the exam environment through `record_event`.
"""

import logging
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.errors import AttemptLocked, Conflict, NotFound, ProctoringNotActive, ValidationFailed
from app.models.attempt import AssessmentAttempt, AttemptStatus
from app.models.base import utcnow
from app.models.proctoring import DeviceState, ProctoringSession, ProctoringSessionStatus
from app.models.proctoring_event import ProctoringEvent, ProctoringEventType
from app.realtime import notify
from app.repositories.proctoring import ProctoringRepository
from app.schemas.proctoring import DeviceReport, ProctoringEventIn
from app.services.proctoring_events import ProctoringEventRecorder

log = logging.getLogger("assessx.proctoring")


class ProctoringService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.sessions = ProctoringRepository(db)
        self.events = ProctoringEventRecorder(db)

    # -- lifecycle hooks called by AttemptService -------------------------------------------

    def open_for(self, attempt: AssessmentAttempt) -> ProctoringSession:
        """Creates the `NOT_STARTED` session for a newly created proctored attempt."""
        # Through the relationship, so `attempt.proctoring_session` is set without a re-read.
        session = self.sessions.add(ProctoringSession(attempt=attempt))
        log.info("Proctoring session created", extra=self._context(attempt, session))
        return session

    def end_for(self, attempt: AssessmentAttempt) -> None:
        """Ends the attempt's session because the attempt has finalized. Idempotent.

        `ended_at` is the attempt's `finalized_at`, so a session whose exam timed out ends at the
        deadline — when the exam actually ended — rather than whenever the server noticed. It is
        never earlier than `started_at`.
        """
        session = attempt.proctoring_session
        if session is None or session.is_ended:
            return
        ended_at = attempt.finalized_at or utcnow()
        if session.started_at is not None and ended_at < session.started_at:
            ended_at = session.started_at
        was = session.status
        session.status = ProctoringSessionStatus.ENDED
        session.ended_at = ended_at
        self.db.flush()
        self.events.record_server(
            session,
            ProctoringEventType.SESSION_ENDED,
            {"attempt_status": attempt.status.value},
            at=ended_at,
        )
        log.info(
            "Proctoring session ended",
            extra={
                **self._context(attempt, session),
                "previous_status": was,
                "attempt_status": attempt.status,
            },
        )
        notify.session_changed(self.db, attempt.id)  # admins: this candidate has left the wall

    def require_active_if_proctored(self, attempt: AssessmentAttempt) -> None:
        """Refuses exam activity on a proctored attempt whose devices were never confirmed.

        Unproctored attempts (no session) pass straight through, which is what keeps Phase 3
        behaviour unchanged for every assessment without `proctoring_required`.
        """
        session = attempt.proctoring_session
        if session is not None and session.status is ProctoringSessionStatus.NOT_STARTED:
            raise ProctoringNotActive()

    # -- candidate operations ------------------------------------------------------------

    def session_of(self, attempt: AssessmentAttempt) -> ProctoringSession:
        """The attempt's session, or 404 when the attempt is not proctored."""
        session = attempt.proctoring_session
        if session is None:
            raise NotFound("This exam is not proctored.")
        return session

    def activate(self, attempt: AssessmentAttempt, report: DeviceReport) -> ProctoringSession:
        """Confirms the candidate's devices and starts proctoring: `NOT_STARTED → ACTIVE`.

        Repeating it on an `ACTIVE` session is how a resumed exam re-confirms its devices after the
        application was reopened: the device state is refreshed and `started_at` is left alone, so
        a retried or repeated call is harmless.

        `attempt` must be the candidate's own, settled and locked (`AttemptService.
        get_attempt_for_update`), so activation cannot race a submission or the deadline.
        """
        self._require_open(attempt)
        session = self.session_of(attempt)
        if session.is_ended:
            # Unreachable while the attempt is open; refused rather than reopened if it ever is.
            raise Conflict("This proctoring session has ended.")

        if not (report.camera is DeviceState.READY and report.microphone is DeviceState.READY):
            log.warning(
                "Proctoring activation refused: devices not ready",
                extra={
                    **self._context(attempt, session),
                    "camera": report.camera,
                    "microphone": report.microphone,
                },
            )
            raise ValidationFailed(
                "Your camera and microphone must both be ready before the exam can begin.",
                details=[
                    {"field": field, "message": f"Reported as {state.value}."}
                    for field, state in (("camera", report.camera), ("microphone", report.microphone))
                    if state is not DeviceState.READY
                ],
            )

        now = utcnow()
        resumed = session.is_active
        if not resumed:
            session.status = ProctoringSessionStatus.ACTIVE
            session.started_at = now
        self._record(session, report, now)
        self.events.record_server(
            session,
            ProctoringEventType.SESSION_RESUMED if resumed else ProctoringEventType.SESSION_STARTED,
            at=now,
        )
        log.info(
            "Proctoring session resumed" if resumed else "Proctoring session activated",
            extra=self._context(attempt, session),
        )
        notify.session_changed(self.db, attempt.id)  # admins: a candidate is now on the wall
        return session

    def report_devices(self, attempt: AssessmentAttempt, report: DeviceReport) -> ProctoringSession:
        """Records a change in device availability during the exam (e.g. a camera unplugged).

        Only while the session is `ACTIVE`: before activation the readiness check is the place for
        this, and after the attempt ends there is nothing left to report on. A device that stops
        working is logged; it does not pause the clock, block answering or mark the candidate —
        what should happen then is an open product decision (`docs/PHASE-4-PLAN.md`).
        """
        self._require_open(attempt)
        session = self.session_of(attempt)
        if session.status is ProctoringSessionStatus.NOT_STARTED:
            raise ProctoringNotActive()
        if session.is_ended:
            raise Conflict("This proctoring session has ended.")

        for device, before, after in (
            ("camera", session.camera_state, report.camera),
            ("microphone", session.microphone_state, report.microphone),
        ):
            if before is after:
                continue
            # The device report is the established Phase 4A path; the event log records its
            # meaningful transitions (lost / back) rather than a second client-side report.
            if (before is DeviceState.READY) != (after is DeviceState.READY):
                self.events.record_server(session, _device_event(device, after), {"state": after.value})
            extra = {
                **self._context(attempt, session),
                "device": device,
                "previous_state": before,
                "state": after,
            }
            if after is DeviceState.READY:
                log.info("Proctoring device recovered", extra=extra)
            else:
                log.warning("Proctoring device not ready", extra=extra)

        self._record(session, report, utcnow())
        notify.session_changed(self.db, attempt.id)  # admins: device state changed
        return session

    def record_event(
        self, attempt: AssessmentAttempt, payload: ProctoringEventIn
    ) -> tuple[ProctoringEvent, bool]:
        """Records an environment event the candidate's app observed (Phase 4B).

        Only for the candidate's own, open, *active* proctored attempt — `attempt` has been scoped
        and locked by `AttemptService.get_attempt_for_update`. Events before activation are refused
        (`proctoring_not_active`) and after the attempt ends are refused (`attempt_locked`), so the
        log covers exactly the proctored exam.
        """
        self._require_open(attempt)
        session = self.session_of(attempt)
        if session.status is ProctoringSessionStatus.NOT_STARTED:
            raise ProctoringNotActive()
        if session.is_ended:
            raise Conflict("This proctoring session has ended.")
        event, created = self.events.record_client(
            session,
            payload.event_type,
            payload.metadata,
            client_event_id=payload.client_event_id,
            client_reported_at=payload.client_reported_at,
        )
        if created:
            log.info(
                "Proctoring event recorded",
                extra={**self._context(attempt, session), "event_type": event.event_type},
            )
            notify.event_recorded(self.db, session, event)
            notify.session_changed(self.db, attempt.id)  # e.g. a fullscreen change moves the tile
        return event, created

    # -- internals ------------------------------------------------------------------------

    def _record(self, session: ProctoringSession, report: DeviceReport, now: datetime) -> None:
        session.camera_state = report.camera
        session.microphone_state = report.microphone
        session.devices_reported_at = now
        self.db.flush()

    @staticmethod
    def _require_open(attempt: AssessmentAttempt) -> None:
        if attempt.is_finalized:
            raise AttemptLocked(
                "Time ran out for this exam."
                if attempt.status is AttemptStatus.TIME_EXPIRED
                else "This exam has been submitted and can no longer be changed."
            )

    @staticmethod
    def _context(attempt: AssessmentAttempt, session: ProctoringSession) -> dict[str, str]:
        # Ids only: no names, emails or roll numbers in proctoring logs.
        return {
            "proctoring_session_id": str(session.id),
            "attempt_id": str(attempt.id),
            "user_id": str(attempt.candidate_id),
        }


def _device_event(device: str, state: DeviceState) -> ProctoringEventType:
    ready = state is DeviceState.READY
    if device == "camera":
        return ProctoringEventType.CAMERA_RECONNECTED if ready else ProctoringEventType.CAMERA_DISCONNECTED
    return ProctoringEventType.MIC_RECONNECTED if ready else ProctoringEventType.MIC_DISCONNECTED
