"""Phase 7C — the human review of an interview session.

Follows Phase 6C's review patterns (lifecycle, immutable notes, immutable decision revisions with the
basis they were made on, optimistic concurrency, append-only audit) in its own tables: the 6C tables are
bound to assessment attempts, proctoring evidence and misconduct outcomes, which do not describe interview
performance.

**The outcome is a human administrative interpretation.** Nothing computes, suggests or pre-selects it,
and no AI score ever sets a status or an outcome. The AI evaluations it rests on are only read — never
changed — and a reviewer's disagreement with one is recorded next to it, never in place of it.
"""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.user import User


class InterviewReviewStatus(enum.StrEnum):
    """UNREVIEWED is the absence of a row; IN_REVIEW → REVIEWED; changes after that are revisions."""

    IN_REVIEW = "IN_REVIEW"
    REVIEWED = "REVIEWED"


INTERVIEW_UNREVIEWED = "UNREVIEWED"


class InterviewReviewOutcome(enum.StrEnum):
    """A person's interpretation of the interview — never an AI classification, never automatic.

    Not an employment decision: it records how the reviewer read this interview, next to (never instead
    of) the AI evaluation. INCONCLUSIVE is for a session that does not represent the candidate (technical
    problems, an abandoned interview).
    """

    MEETS_EXPECTATIONS = "MEETS_EXPECTATIONS"
    NEEDS_FURTHER_ASSESSMENT = "NEEDS_FURTHER_ASSESSMENT"
    DOES_NOT_MEET_EXPECTATIONS = "DOES_NOT_MEET_EXPECTATIONS"
    INCONCLUSIVE = "INCONCLUSIVE"


class AnswerMark(enum.StrEnum):
    """A reviewer's view of one AI evaluation. Recorded beside it; the AI score never changes."""

    AGREE = "AGREE"
    DISAGREE = "DISAGREE"


EVALUATION_STATES = ("NONE", "PENDING", "PARTIAL", "COMPLETE")


def _in(column: str, values: type[enum.StrEnum] | tuple[str, ...]) -> str:
    items = [v.value for v in values] if isinstance(values, type) else list(values)
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in items) + ")"


def _enum(kind: type[enum.StrEnum], name: str) -> Enum:
    return Enum(kind, name=name, native_enum=False, length=40, validate_strings=True)


class InterviewReview(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "interview_reviews"
    __table_args__ = (
        CheckConstraint(_in("status", InterviewReviewStatus), name="ck_interview_reviews_status"),
        CheckConstraint(
            "outcome IS NULL OR " + _in("outcome", InterviewReviewOutcome),
            name="ck_interview_reviews_outcome",
        ),
        CheckConstraint("version >= 1", name="ck_interview_reviews_version"),
        CheckConstraint(
            "(status = 'REVIEWED') = (outcome IS NOT NULL)", name="ck_interview_reviews_reviewed_iff_outcome"
        ),
        CheckConstraint(
            "(status = 'REVIEWED') = (completed_by_id IS NOT NULL AND completed_at IS NOT NULL)",
            name="ck_interview_reviews_reviewed_iff_completed",
        ),
        CheckConstraint(
            "completed_at IS NULL OR completed_at >= started_at",
            name="ck_interview_reviews_completed_after_start",
        ),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    status: Mapped[InterviewReviewStatus] = mapped_column(
        _enum(InterviewReviewStatus, "interview_review_status"), nullable=False, index=True
    )
    outcome: Mapped[InterviewReviewOutcome | None] = mapped_column(
        _enum(InterviewReviewOutcome, "interview_review_outcome"), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    started_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    completed_by_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    started_by: Mapped["User"] = relationship(foreign_keys=[started_by_id], lazy="joined")
    completed_by: Mapped["User | None"] = relationship(foreign_keys=[completed_by_id], lazy="joined")


class InterviewReviewNote(UUIDPrimaryKeyMixin, Base):
    """Human-authored and immutable (no edit or delete path, no `updated_at`). Never logged."""

    __tablename__ = "interview_review_notes"
    __table_args__ = (
        CheckConstraint("char_length(body) BETWEEN 1 AND 4000", name="ck_interview_review_notes_body"),
        Index("ix_interview_review_notes_review_created", "review_id", "created_at"),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_reviews.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    author: Mapped["User"] = relationship(lazy="joined")


class InterviewReviewDecision(UUIDPrimaryKeyMixin, Base):
    """One recorded human outcome — revision 1 at completion, 2… for each revision. Immutable.

    Keeps the **basis**: the AI report figures the reviewer saw (report policy version, AI score and
    whether it was partial, coverage, evaluation state, evaluator and rubric versions) — a record, never an
    input to the outcome.
    """

    __tablename__ = "interview_review_decisions"
    __table_args__ = (
        UniqueConstraint("review_id", "revision", name="uq_interview_review_decisions_revision"),
        CheckConstraint("revision >= 1", name="ck_interview_review_decisions_revision"),
        CheckConstraint(_in("outcome", InterviewReviewOutcome), name="ck_interview_review_decisions_outcome"),
        CheckConstraint(
            "char_length(rationale) BETWEEN 1 AND 4000", name="ck_interview_review_decisions_rationale"
        ),
        CheckConstraint(
            "ai_score IS NULL OR ai_score BETWEEN 0 AND 100", name="ck_interview_review_decisions_score"
        ),
        CheckConstraint(
            _in("evaluation_state", EVALUATION_STATES), name="ck_interview_review_decisions_state"
        ),
        CheckConstraint(
            "evaluated_primaries >= 0 AND answered_primaries >= evaluated_primaries "
            "AND planned_primaries >= answered_primaries",
            name="ck_interview_review_decisions_counts",
        ),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_reviews.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    outcome: Mapped[InterviewReviewOutcome] = mapped_column(
        _enum(InterviewReviewOutcome, "interview_review_outcome"), nullable=False
    )
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    decided_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    # -- the basis: the AI report figures at the moment of the decision ------------------------------
    report_policy_version: Mapped[str] = mapped_column(String(20), nullable=False)
    ai_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ai_score_partial: Mapped[bool] = mapped_column(Boolean, nullable=False)
    evaluation_state: Mapped[str] = mapped_column(String(20), nullable=False)
    evaluated_primaries: Mapped[int] = mapped_column(Integer, nullable=False)
    answered_primaries: Mapped[int] = mapped_column(Integer, nullable=False)
    planned_primaries: Mapped[int] = mapped_column(Integer, nullable=False)
    evaluator_versions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    rubric_versions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)

    decided_by: Mapped["User"] = relationship(lazy="joined")


class InterviewReviewMark(UUIDPrimaryKeyMixin, Base):
    """A reviewer's agreement or disagreement with one answer's AI evaluation. Append-only; newest wins."""

    __tablename__ = "interview_review_marks"
    __table_args__ = (
        CheckConstraint(_in("mark", AnswerMark), name="ck_interview_review_marks_mark"),
        Index("ix_interview_review_marks_review_item", "review_id", "item_id", "created_at"),
    )

    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_reviews.id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_session_items.id", ondelete="CASCADE"), nullable=False
    )
    evaluation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_evaluations.id", ondelete="CASCADE"), nullable=False
    )
    mark: Mapped[AnswerMark] = mapped_column(_enum(AnswerMark, "interview_answer_mark"), nullable=False)
    author_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    author: Mapped["User"] = relationship(lazy="joined")
