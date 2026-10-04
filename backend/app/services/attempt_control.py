"""Exam control: the tab-switch rule, and holding (freezing), releasing or ending an attempt.

**The tab-switch rule.** The candidate's app reports every return to the exam window
(`FOCUS_REGAINED`, with how long it was away). The server counts a return as a *tab switch* when the
window was away for longer than `TAB_SWITCH_GRACE_MS`, so a split-second focus blip from a Windows
notification or popup never costs a candidate anything. The first `TAB_SWITCH_LIMIT - 1` switches are
warnings; the next one puts the attempt **on hold** automatically. The count lives on the attempt and is
only ever changed here, so the client cannot reset it.

**On hold** means frozen, not finished: the candidate cannot save answers or submit until an
administrator releases the attempt, and the clock keeps running (an attempt that runs out of time while
held ends as usual). An administrator can also hold an attempt themselves, release it, or end the exam
on the candidate's behalf, which submits the answers saved so far. A released attempt keeps its count,
so a further switch after release holds it again at once.

Every hold, release and end is written to the append-only audit log (never the administrator's note
text), and pushed live to the candidate's app and to the monitoring wall.
"""

import logging
import uuid

from sqlalchemy import select

from app.core.errors import AttemptLocked, NotFound
from app.models.attempt import AssessmentAttempt, AttemptStatus, HoldReason
from app.models.audit_log import AuditAction
from app.models.base import utcnow
from app.models.user import User
from app.realtime import notify
from app.repositories.audit import AuditRepository

log = logging.getLogger("assessx.attempts.control")

#: A return to the window after being away at most this long is not a tab switch.
TAB_SWITCH_GRACE_MS = 2000
#: The switch that reaches this count puts the attempt on hold; the ones before it are warnings.
TAB_SWITCH_LIMIT = 3


class AttemptControlService:
    def __init__(self, db) -> None:  # noqa: ANN001 — a SQLAlchemy Session
        self.db = db
        self.audit = AuditRepository(db)

    # -- the tab-switch rule (candidate side, from proctoring events) ----------------------------------

    def focus_returned(self, attempt: AssessmentAttempt, away_ms: int) -> bool:
        """Counts a return to the exam window. True when it counted as a tab switch.

        `attempt` is already locked (`FOR UPDATE`) by the event route. Nothing is counted while the
        attempt is on hold or finished, or for an absence within the grace period.
        """
        if not attempt.is_active or attempt.is_on_hold or away_ms <= TAB_SWITCH_GRACE_MS:
            return False
        attempt.tab_switch_count += 1
        if attempt.tab_switch_count >= TAB_SWITCH_LIMIT:
            self._hold(
                attempt, HoldReason.TAB_SWITCH_LIMIT, actor_id=attempt.candidate_id, admin=None, note=None
            )
        else:
            self.db.flush()
            log.info(
                "Tab switch counted",
                extra={"attempt_id": str(attempt.id), "tab_switches": attempt.tab_switch_count},
            )
        notify.attempt_control(self.db, attempt)
        return True

    # -- administrator actions -------------------------------------------------------------------------

    def for_admin(self, attempt_id: uuid.UUID) -> AssessmentAttempt:
        """The attempt, locked for the change, with the clock applied first."""
        from app.services.attempts import AttemptService

        attempt = self.db.scalar(
            select(AssessmentAttempt)
            .where(AssessmentAttempt.id == attempt_id)
            .with_for_update(of=AssessmentAttempt)
            .execution_options(populate_existing=True)
        )
        if attempt is None:
            raise NotFound("Attempt not found.")
        return AttemptService(self.db).settle(attempt)

    def hold(self, attempt_id: uuid.UUID, admin: User, note: str | None) -> AssessmentAttempt:
        attempt = self.for_admin(attempt_id)
        self._require_open(attempt)
        if not attempt.is_on_hold:  # holding twice is not an error
            self._hold(attempt, HoldReason.ADMIN, actor_id=admin.id, admin=admin, note=note)
            notify.attempt_control(self.db, attempt)
        return attempt

    def release(self, attempt_id: uuid.UUID, admin: User) -> AssessmentAttempt:
        attempt = self.for_admin(attempt_id)
        self._require_open(attempt)
        if attempt.is_on_hold:  # releasing twice is not an error
            held_for = int((utcnow() - attempt.held_at).total_seconds()) if attempt.held_at else 0
            reason = attempt.hold_reason
            attempt.held_at = attempt.hold_reason = attempt.held_by_id = attempt.hold_note = None
            self.db.flush()
            self._record(
                admin.id,
                AuditAction.ATTEMPT_RELEASED,
                attempt,
                reason=reason.value if reason else None,
                held_seconds=held_for,
                tab_switches=attempt.tab_switch_count,
            )
            notify.attempt_control(self.db, attempt)
        return attempt

    def end(self, attempt_id: uuid.UUID, admin: User) -> AssessmentAttempt:
        """Ends the exam for the candidate: the answers saved so far are submitted and graded.
        Idempotent for an attempt that has already finished."""
        from app.services.evaluation import EvaluationService
        from app.services.proctoring import ProctoringService

        attempt = self.for_admin(attempt_id)
        if attempt.is_finalized:
            return attempt
        now = utcnow()
        attempt.status = AttemptStatus.SUBMITTED
        attempt.submitted_at = now
        attempt.finalized_at = now
        attempt.ended_by_id = admin.id
        self.db.flush()
        ProctoringService(self.db).end_for(attempt)
        EvaluationService(self.db).ensure_result(attempt)
        self._record(
            admin.id, AuditAction.ATTEMPT_ENDED_BY_ADMIN, attempt, was_on_hold=attempt.held_at is not None
        )
        notify.attempt_control(self.db, attempt)
        return attempt

    # -- internals -------------------------------------------------------------------------------------

    @staticmethod
    def _require_open(attempt: AssessmentAttempt) -> None:
        if attempt.is_finalized:
            raise AttemptLocked("This exam has already ended.")

    def _hold(
        self,
        attempt: AssessmentAttempt,
        reason: HoldReason,
        *,
        actor_id: uuid.UUID,
        admin: User | None,
        note: str | None,
    ) -> None:
        attempt.held_at = utcnow()
        attempt.hold_reason = reason
        attempt.held_by_id = admin.id if admin else None
        attempt.hold_note = note
        self.db.flush()
        self._record(
            actor_id,
            AuditAction.ATTEMPT_HELD,
            attempt,
            reason=reason.value,
            trigger="ADMIN" if admin else "AUTOMATIC",
            tab_switches=attempt.tab_switch_count,
            note_length=len(note) if note else None,
        )

    def _record(
        self, actor_id: uuid.UUID, action: AuditAction, attempt: AssessmentAttempt, **details: object
    ) -> None:
        self.audit.record(
            actor_id=actor_id,
            action=action,
            attempt_id=attempt.id,
            assessment_id=attempt.assessment_id,
            details={k: v for k, v in details.items() if v is not None},
        )
        log.info("Exam control", extra={"action": action.value, "attempt_id": str(attempt.id)})
