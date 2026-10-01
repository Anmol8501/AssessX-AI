import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Select, String, func, select, tuple_
from sqlalchemy.orm import Session

from app.models.attempt import AssessmentAttempt
from app.models.proctoring import ProctoringSession
from app.models.review import (
    UNREVIEWED,
    AttemptReview,
    ReviewDecision,
    ReviewMark,
    ReviewNote,
)


@dataclass(frozen=True)
class QueueFilter:
    review_status: str | None = None
    assessment_id: uuid.UUID | None = None
    finished_from: datetime | None = None
    finished_to: datetime | None = None


@dataclass(frozen=True)
class QueueRow:
    attempt: AssessmentAttempt
    session: ProctoringSession
    review: AttemptReview | None


class ReviewRepository:
    """Phase 6C reviews. A review is always reached through its attempt id — never by a review id
    taken from a request — so one attempt's path can never reach another attempt's review."""

    def __init__(self, db: Session) -> None:
        self.db = db

    # -- the attempt -----------------------------------------------------------------------

    def attempt(self, attempt_id: uuid.UUID) -> AssessmentAttempt | None:
        return self.db.scalar(select(AssessmentAttempt).where(AssessmentAttempt.id == attempt_id))

    def attempt_locked(self, attempt_id: uuid.UUID) -> AssessmentAttempt | None:
        """The attempt held `FOR UPDATE`, so completing a review serialises with a submit or expiry.

        `of=` because the attempt eager-loads its assessment and candidate as outer joins.
        """
        return self.db.scalar(
            select(AssessmentAttempt)
            .where(AssessmentAttempt.id == attempt_id)
            .with_for_update(of=AssessmentAttempt)
        )

    # -- the review ------------------------------------------------------------------------

    def get(self, attempt_id: uuid.UUID) -> AttemptReview | None:
        return self.db.scalar(select(AttemptReview).where(AttemptReview.attempt_id == attempt_id))

    def get_locked(self, attempt_id: uuid.UUID) -> AttemptReview | None:
        """The review held `FOR UPDATE` until the transaction ends.

        Every state change reads the row through here, so two administrators deciding at once
        serialise: the second reads the first one's committed state (and its new `version`) rather
        than overwriting it. `populate_existing` so an already-loaded row is refreshed from the lock.
        """
        return self.db.scalar(
            select(AttemptReview)
            .where(AttemptReview.attempt_id == attempt_id)
            .with_for_update(of=AttemptReview)
            .execution_options(populate_existing=True)
        )

    def add(self, row: object) -> None:
        self.db.add(row)
        self.db.flush()

    def notes(self, review_id: uuid.UUID) -> list[ReviewNote]:
        return list(
            self.db.scalars(
                select(ReviewNote)
                .where(ReviewNote.review_id == review_id)
                .order_by(ReviewNote.created_at, ReviewNote.id)
            )
        )

    def decisions(self, review_id: uuid.UUID) -> list[ReviewDecision]:
        """Newest revision first."""
        return list(
            self.db.scalars(
                select(ReviewDecision)
                .where(ReviewDecision.review_id == review_id)
                .order_by(ReviewDecision.revision.desc())
            )
        )

    def next_revision(self, review_id: uuid.UUID) -> int:
        highest = self.db.scalar(
            select(func.max(ReviewDecision.revision)).where(ReviewDecision.review_id == review_id)
        )
        return (highest or 0) + 1

    def current_marks(self, review_id: uuid.UUID) -> dict[uuid.UUID, ReviewMark]:
        """`{evidence id: newest mark}`. Bounded by the attempt's evidence (≤ its event ceiling)."""
        current: dict[uuid.UUID, ReviewMark] = {}
        rows = self.db.scalars(
            select(ReviewMark)
            .where(ReviewMark.review_id == review_id)
            .order_by(ReviewMark.created_at, ReviewMark.id)
        )
        for mark in rows:
            current[mark.evidence_event_id] = mark  # ascending order leaves the newest last
        return current

    # -- the queue -------------------------------------------------------------------------

    def _filtered(self, query: Select, f: QueueFilter, *, with_status: bool) -> Select:
        if f.assessment_id is not None:
            query = query.where(AssessmentAttempt.assessment_id == f.assessment_id)
        if f.finished_from is not None:
            query = query.where(AssessmentAttempt.finalized_at >= f.finished_from)
        if f.finished_to is not None:
            query = query.where(AssessmentAttempt.finalized_at < f.finished_to)
        if with_status and f.review_status is not None:
            if f.review_status == UNREVIEWED:
                query = query.where(AttemptReview.id.is_(None))
            else:
                query = query.where(AttemptReview.status == f.review_status)
        return query

    def queue(
        self, f: QueueFilter, *, limit: int, after: tuple[datetime, uuid.UUID] | None
    ) -> list[QueueRow]:
        """Proctored attempts, newest first, keyset-paged on `(started_at, id)`. `limit + 1` rows are
        read so the caller knows whether another page exists."""
        query = (
            select(AssessmentAttempt, ProctoringSession, AttemptReview)
            .join(ProctoringSession, ProctoringSession.attempt_id == AssessmentAttempt.id)
            .outerjoin(AttemptReview, AttemptReview.attempt_id == AssessmentAttempt.id)
        )
        query = self._filtered(query, f, with_status=True)
        if after is not None:
            query = query.where(tuple_(AssessmentAttempt.started_at, AssessmentAttempt.id) < tuple_(*after))
        query = query.order_by(AssessmentAttempt.started_at.desc(), AssessmentAttempt.id.desc()).limit(
            limit + 1
        )
        return [QueueRow(a, s, r) for a, s, r in self.db.execute(query).all()]

    def counts(self, f: QueueFilter) -> dict[str, int]:
        """Proctored attempts per review status, under the same filters (except status)."""
        status = func.coalesce(AttemptReview.status, UNREVIEWED, type_=String)
        query = (
            select(status, func.count())
            .select_from(AssessmentAttempt)
            .join(ProctoringSession, ProctoringSession.attempt_id == AssessmentAttempt.id)
            .outerjoin(AttemptReview, AttemptReview.attempt_id == AssessmentAttempt.id)
            .group_by(status)
        )
        query = self._filtered(query, f, with_status=False)
        return {str(key): int(count) for key, count in self.db.execute(query).all()}
