import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.attempt import AssessmentAttempt
    from app.models.user import User


class ReviewStatus(enum.StrEnum):
    """Where a human review of one attempt is (Phase 6C).

    `UNREVIEWED` is not stored: it is the absence of a review row, so no attempt ever needs a
    back-filled row. Starting a review creates the row as `IN_REVIEW`; completing it moves it to
    `REVIEWED`. Nothing moves a review backwards — a later change of mind is a new *revision* of the
    decision (see `ReviewDecision`), never an overwrite.
    """

    IN_REVIEW = "IN_REVIEW"
    REVIEWED = "REVIEWED"


#: The reported status of an attempt that has no review row.
UNREVIEWED = "UNREVIEWED"


class ReviewOutcome(enum.StrEnum):
    """The administrator's recorded outcome — human-authored, never computed.

    Administrative language, not an AI classification: the risk level (Phase 6A) is a signal and
    places no constraint on the outcome. A HIGH-risk attempt may be CLEARED; a NORMAL one FLAGGED.
    `FLAGGED` is this build's equivalent of PRD FR-018 "escalate case" (there is one admin role).
    `INVALIDATED` is recorded only: it does not change the attempt, its score or what the candidate
    sees (a result change is a separate, audited action that does not exist yet).
    """

    NO_ACTION = "NO_ACTION"
    CLEARED = "CLEARED"
    FLAGGED = "FLAGGED"
    INVALIDATED = "INVALIDATED"


class EvidenceMark(enum.StrEnum):
    """A reviewer's annotation on one evidence item (PRD FR-018 "confirm event" / "dismiss event").

    CONFIRMED: the observation is accurate and relevant. DISMISSED: not relevant (for example a
    false positive). A mark never changes the evidence or the risk score.
    """

    CONFIRMED = "CONFIRMED"
    DISMISSED = "DISMISSED"


def _in(column: str, values: type[enum.StrEnum]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v.value}'" for v in values) + ")"


_RISK_LEVELS = "('NORMAL', 'LOW', 'MEDIUM', 'HIGH')"


class AttemptReview(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """The human review of one proctored attempt (Phase 6C). At most one per attempt.

    Holds the *current* state — status, outcome and who/when — for the queue to filter on. Every
    decision that produced that state is kept, unchanged, in `review_decisions`; every action in
    `audit_logs`. `version` increases on each state transition and is what the client sends back as
    `expected_version`, so two administrators can never silently overwrite each other.

    The reviewer and every timestamp are the server's: no request carries an identity or a time.
    No candidate data is copied here — the attempt already identifies the candidate.
    """

    __tablename__ = "attempt_reviews"
    __table_args__ = (
        CheckConstraint(_in("status", ReviewStatus), name="ck_attempt_reviews_status"),
        CheckConstraint(
            "outcome IS NULL OR " + _in("outcome", ReviewOutcome), name="ck_attempt_reviews_outcome"
        ),
        CheckConstraint("version >= 1", name="ck_attempt_reviews_version_positive"),
        # A REVIEWED review has an outcome and says who completed it and when; an open one has none.
        CheckConstraint(
            "(status = 'REVIEWED') = (outcome IS NOT NULL)", name="ck_attempt_reviews_reviewed_iff_outcome"
        ),
        CheckConstraint(
            "(status = 'REVIEWED') = (completed_by_id IS NOT NULL AND completed_at IS NOT NULL)",
            name="ck_attempt_reviews_reviewed_iff_completed",
        ),
        CheckConstraint(
            "completed_at IS NULL OR completed_at >= started_at",
            name="ck_attempt_reviews_completed_after_start",
        ),
    )

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessment_attempts.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    status: Mapped[ReviewStatus] = mapped_column(
        Enum(ReviewStatus, name="review_status", native_enum=False, length=20, validate_strings=True),
        nullable=False,
        default=ReviewStatus.IN_REVIEW,
        index=True,
    )
    outcome: Mapped[ReviewOutcome | None] = mapped_column(
        Enum(ReviewOutcome, name="review_outcome", native_enum=False, length=20, validate_strings=True),
        nullable=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    started_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    #: Who recorded the current decision, and when (the latest revision).
    completed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    attempt: Mapped["AssessmentAttempt"] = relationship()
    started_by: Mapped["User"] = relationship(foreign_keys=[started_by_id], lazy="joined")
    completed_by: Mapped["User | None"] = relationship(foreign_keys=[completed_by_id], lazy="joined")

    def __repr__(self) -> str:
        return f"<AttemptReview attempt={self.attempt_id} {self.status} v{self.version}>"


class ReviewNote(UUIDPrimaryKeyMixin, Base):
    """A human-authored note on a review. Immutable: there is no edit or delete path, and no
    `updated_at`. A correction is a new note. The text is never logged."""

    __tablename__ = "review_notes"
    __table_args__ = (
        CheckConstraint("char_length(body) BETWEEN 1 AND 4000", name="ck_review_notes_body_length"),
        Index("ix_review_notes_review_created", "review_id", "created_at"),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("attempt_reviews.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    author: Mapped["User"] = relationship(lazy="joined")


class ReviewDecision(UUIDPrimaryKeyMixin, Base):
    """One recorded administrative outcome — revision 1 at completion, 2… for each revision.

    Immutable. The newest revision is the current outcome; earlier ones stay so the record shows a
    previous decision existed. It also stores the **basis**: the risk and evidence summary the
    reviewer saw, because 6A/6B are recomputed on demand and a later policy could show different
    numbers. The basis is a copy for the record — it is never fed back into the risk engine.
    """

    __tablename__ = "review_decisions"
    __table_args__ = (
        UniqueConstraint("review_id", "revision", name="uq_review_decisions_revision"),
        CheckConstraint("revision >= 1", name="ck_review_decisions_revision_positive"),
        CheckConstraint(_in("outcome", ReviewOutcome), name="ck_review_decisions_outcome"),
        CheckConstraint(
            "char_length(rationale) BETWEEN 1 AND 4000", name="ck_review_decisions_rationale_length"
        ),
        CheckConstraint("risk_score BETWEEN 0 AND 100", name="ck_review_decisions_risk_score"),
        CheckConstraint("peak_score BETWEEN 0 AND 100", name="ck_review_decisions_peak_score"),
        CheckConstraint(f"risk_level IN {_RISK_LEVELS}", name="ck_review_decisions_risk_level"),
        CheckConstraint(f"peak_level IN {_RISK_LEVELS}", name="ck_review_decisions_peak_level"),
        CheckConstraint(
            "signal_count >= 0 AND evidence_count >= 0 AND episode_count >= 0",
            name="ck_review_decisions_counts",
        ),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("attempt_reviews.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    outcome: Mapped[ReviewOutcome] = mapped_column(
        Enum(ReviewOutcome, name="review_outcome", native_enum=False, length=20, validate_strings=True),
        nullable=False,
    )
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    decided_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    # -- the basis: what 6A/6B showed when the decision was made --------------------------------
    policy_version: Mapped[str] = mapped_column(Text, nullable=False)
    evidence_version: Mapped[str] = mapped_column(Text, nullable=False)
    risk_as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False)
    risk_level: Mapped[str] = mapped_column(Text, nullable=False)
    peak_score: Mapped[int] = mapped_column(Integer, nullable=False)
    peak_level: Mapped[str] = mapped_column(Text, nullable=False)
    signal_count: Mapped[int] = mapped_column(Integer, nullable=False)
    evidence_count: Mapped[int] = mapped_column(Integer, nullable=False)
    episode_count: Mapped[int] = mapped_column(Integer, nullable=False)

    decided_by: Mapped["User"] = relationship(lazy="joined")


class ReviewMark(UUIDPrimaryKeyMixin, Base):
    """A reviewer's mark on one evidence item. Append-only: the newest row per item is current.

    `evidence_event_id` is the Phase 6B evidence id, which is the id of the stored event that started
    the item — so it is a real foreign key into the immutable event store, not a free-form string.
    """

    __tablename__ = "review_marks"
    __table_args__ = (
        CheckConstraint(_in("mark", EvidenceMark), name="ck_review_marks_mark"),
        Index("ix_review_marks_review_evidence", "review_id", "evidence_event_id", "created_at"),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("attempt_reviews.id", ondelete="CASCADE"), nullable=False
    )
    evidence_event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("proctoring_events.id", ondelete="CASCADE"), nullable=False
    )
    mark: Mapped[EvidenceMark] = mapped_column(
        Enum(EvidenceMark, name="evidence_mark", native_enum=False, length=20, validate_strings=True),
        nullable=False,
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    author: Mapped["User"] = relationship(lazy="joined")
