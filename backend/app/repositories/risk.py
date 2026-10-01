import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.proctoring import ProctoringSession
from app.models.proctoring_event import ProctoringEvent
from app.services.risk.signals import EventRecord


class RiskRepository:
    """Read-only queries for the Phase 6A risk engine. Nothing here writes."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def session_for_attempt(self, attempt_id: uuid.UUID) -> ProctoringSession | None:
        return self.db.scalar(select(ProctoringSession).where(ProctoringSession.attempt_id == attempt_id))

    def events(self, session_id: uuid.UUID) -> list[EventRecord]:
        """Every event of one session, oldest first, in one query on `(session_id, recorded_at)`.

        Only the columns the engine reads are selected. The session holds at most
        `MAX_EVENTS_PER_SESSION` rows, which bounds this query and the evaluation.
        """
        rows = self.db.execute(
            select(
                ProctoringEvent.id,
                ProctoringEvent.event_type,
                ProctoringEvent.category,
                ProctoringEvent.details,
                ProctoringEvent.recorded_at,
            )
            .where(ProctoringEvent.session_id == session_id)
            .order_by(ProctoringEvent.recorded_at, ProctoringEvent.id)
        )
        return [EventRecord(r.id, r.event_type, r.category, r.details or {}, r.recorded_at) for r in rows]

    def events_for_sessions(self, session_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[EventRecord]]:
        """Every event of several sessions in one query (the review queue's page), oldest first."""
        grouped: dict[uuid.UUID, list[EventRecord]] = {sid: [] for sid in session_ids}
        if not session_ids:
            return grouped
        rows = self.db.execute(
            select(
                ProctoringEvent.session_id,
                ProctoringEvent.id,
                ProctoringEvent.event_type,
                ProctoringEvent.category,
                ProctoringEvent.details,
                ProctoringEvent.recorded_at,
            )
            .where(ProctoringEvent.session_id.in_(session_ids))
            .order_by(ProctoringEvent.session_id, ProctoringEvent.recorded_at, ProctoringEvent.id)
        )
        for r in rows:
            grouped[r.session_id].append(
                EventRecord(r.id, r.event_type, r.category, r.details or {}, r.recorded_at)
            )
        return grouped

    def source_events(self, session_id: uuid.UUID, event_ids: list[uuid.UUID]) -> list[ProctoringEvent]:
        """The stored events behind one evidence item — only within this session (attempt isolation)."""
        if not event_ids:
            return []
        return list(
            self.db.scalars(
                select(ProctoringEvent)
                .where(ProctoringEvent.session_id == session_id, ProctoringEvent.id.in_(event_ids))
                .order_by(ProctoringEvent.recorded_at, ProctoringEvent.id)
            )
        )
