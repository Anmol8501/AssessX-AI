import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.errors import NotFound, ValidationFailed
from app.models.base import utcnow
from app.models.proctoring import ProctoringSession
from app.models.proctoring_event import ProctoringEvent
from app.repositories.risk import RiskRepository
from app.services.risk.engine import RiskAssessment, analyze, evaluate
from app.services.risk.evidence import (
    EvidenceEpisode,
    EvidenceItem,
    EvidencePage,
    EvidenceSet,
    InvalidCursor,
    build_evidence,
    page,
)


@dataclass(frozen=True)
class EvidenceResult:
    evidence: EvidenceSet
    page: EvidencePage


@dataclass(frozen=True)
class ReviewBasis:
    """What 6A and 6B show for an attempt at one moment — recorded with a human review decision."""

    risk: RiskAssessment
    evidence: EvidenceSet


@dataclass(frozen=True)
class EvidenceItemResult:
    evidence: EvidenceSet
    item: EvidenceItem
    episode: EvidenceEpisode | None
    source_events: list[ProctoringEvent]


class RiskService:
    """The authoritative risk state (6A) and evidence (6B) of one attempt, derived from its stored events.

    Derived on demand — nothing is written, so there is no stale state and no concurrency hazard.
    A live session is evaluated as of now; an ended session as of its end, so a finished attempt's
    risk and evidence never change with the passage of time.
    """

    def __init__(self, db: Session) -> None:
        self.repo = RiskRepository(db)

    def _session(self, attempt_id: uuid.UUID) -> ProctoringSession:
        session = self.repo.session_for_attempt(attempt_id)
        if session is None:
            raise NotFound("No proctoring session for that attempt.")
        return session

    def assess(self, attempt_id: uuid.UUID, now: datetime | None = None) -> RiskAssessment:
        session = self._session(attempt_id)
        events = self.repo.events(session.id)
        return evaluate(events, as_of=now or utcnow(), session_end=session.ended_at)

    def basis(self, attempt_id: uuid.UUID, now: datetime | None = None) -> ReviewBasis:
        """The risk and the evidence together, from one read of the events (Phase 6C's decision basis)."""
        session = self._session(attempt_id)
        events = self.repo.events(session.id)
        as_of = now or utcnow()
        risk = evaluate(events, as_of=as_of, session_end=session.ended_at)
        analysis = analyze(events, as_of=as_of, session_end=session.ended_at)
        return ReviewBasis(risk, build_evidence(analysis, session_live=session.ended_at is None))

    def assess_many(
        self, sessions: list[ProctoringSession], now: datetime | None = None
    ) -> dict[uuid.UUID, RiskAssessment]:
        """`{attempt_id: risk}` for a bounded page of sessions, from one events query (no N+1)."""
        as_of = now or utcnow()
        events = self.repo.events_for_sessions([s.id for s in sessions])
        return {s.attempt_id: evaluate(events[s.id], as_of=as_of, session_end=s.ended_at) for s in sessions}

    def _evidence(self, session: ProctoringSession, now: datetime | None) -> EvidenceSet:
        analysis = analyze(self.repo.events(session.id), as_of=now or utcnow(), session_end=session.ended_at)
        return build_evidence(analysis, session_live=session.ended_at is None)

    def evidence(
        self,
        attempt_id: uuid.UUID,
        *,
        now: datetime | None = None,
        limit: int,
        cursor: str | None,
        since: datetime | None,
        until: datetime | None,
    ) -> EvidenceResult:
        evidence = self._evidence(self._session(attempt_id), now)
        try:
            chunk = page(evidence, limit=limit, cursor=cursor, since=since, until=until)
        except InvalidCursor as error:
            raise ValidationFailed(
                "Invalid cursor.",
                details=[{"field": "cursor", "message": "Use next_cursor from a previous page."}],
            ) from error
        return EvidenceResult(evidence, chunk)

    def evidence_item(
        self, attempt_id: uuid.UUID, evidence_id: uuid.UUID, now: datetime | None = None
    ) -> EvidenceItemResult:
        """One item of *this* attempt's evidence. An id from another attempt is simply not found."""
        session = self._session(attempt_id)
        evidence = self._evidence(session, now)
        item = next((i for i in evidence.items if i.evidence_id == str(evidence_id)), None)
        if item is None:
            raise NotFound("No such evidence for that attempt.")
        episode = evidence.episodes.get(item.episode_id) if item.episode_id else None
        sources = self.repo.source_events(session.id, [uuid.UUID(i) for i in item.source_event_ids])
        return EvidenceItemResult(evidence, item, episode, sources)
