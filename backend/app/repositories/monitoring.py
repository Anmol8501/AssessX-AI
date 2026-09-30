import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.attempt import ACTIVE_ATTEMPT_STATUSES, AssessmentAttempt
from app.models.proctoring import ProctoringSession, ProctoringSessionStatus
from app.models.proctoring_event import ProctoringEvent


class MonitoringRepository:
    """Read-only queries for the admin live-monitoring wall (Phase 4C).

    Nothing here writes. "Monitorable" is defined only in terms of the existing lifecycle: an
    attempt that is still active and whose proctoring session is `ACTIVE`. Unproctored attempts
    (no session) and finished ones are excluded by that join.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def active_sessions(self) -> list[ProctoringSession]:
        """Every active proctoring session whose attempt is still open, newest first.

        Eager-loads the attempt, its candidate and its assessment so the wall renders in one query.
        """
        return list(
            self.db.scalars(
                select(ProctoringSession)
                .join(AssessmentAttempt, AssessmentAttempt.id == ProctoringSession.attempt_id)
                .options(
                    joinedload(ProctoringSession.attempt).joinedload(AssessmentAttempt.candidate),
                    joinedload(ProctoringSession.attempt).joinedload(AssessmentAttempt.assessment),
                )
                .where(
                    ProctoringSession.status == ProctoringSessionStatus.ACTIVE,
                    AssessmentAttempt.status.in_(ACTIVE_ATTEMPT_STATUSES),
                )
                .order_by(ProctoringSession.started_at.desc())
            ).unique()
        )

    def session_for_attempt(self, attempt_id: uuid.UUID) -> ProctoringSession | None:
        """One attempt's proctoring session (any status), for the detail view."""
        return self.db.scalar(
            select(ProctoringSession)
            .options(
                joinedload(ProctoringSession.attempt).joinedload(AssessmentAttempt.candidate),
                joinedload(ProctoringSession.attempt).joinedload(AssessmentAttempt.assessment),
            )
            .where(ProctoringSession.attempt_id == attempt_id)
        )

    def recent_events(self, session_id: uuid.UUID, limit: int) -> list[ProctoringEvent]:
        """The session's most recent events, newest first (capped)."""
        return list(
            self.db.scalars(
                select(ProctoringEvent)
                .where(ProctoringEvent.session_id == session_id)
                .order_by(ProctoringEvent.recorded_at.desc())
                .limit(limit)
            )
        )
