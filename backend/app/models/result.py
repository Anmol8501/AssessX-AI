import uuid
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.assessment import Assessment
    from app.models.attempt import AssessmentAttempt
    from app.models.user import User


class AttemptResult(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """What one finished attempt scored.

    **A snapshot, not a view.** Every number is computed once, when the attempt is finalized, and
    then left alone. That matters because a published assessment is not currently immutable — an
    administrator can still change a question's marks or its answer key (see
    `docs/PHASE-3-PLAN.md`). Recomputing on read would let a result silently change after the
    candidate had been told it; storing it means a later edit cannot rewrite history, and the
    divergence is at least visible rather than invisible.

    `passing_marks` is snapshotted for the same reason: the result records the threshold it was
    actually judged against, not whatever the assessment says today.

    Nothing here is ever accepted from a request. The candidate's client cannot tell the server
    what it scored; these values come only from stored answers and stored answer keys.
    """

    __tablename__ = "attempt_results"
    __table_args__ = (
        # One attempt, one result. The database refuses a second rather than trusting the service.
        UniqueConstraint("attempt_id", name="uq_attempt_result_attempt"),
        CheckConstraint("score >= 0", name="ck_results_score_non_negative"),
        CheckConstraint("maximum_score >= 0", name="ck_results_maximum_non_negative"),
        CheckConstraint("score <= maximum_score", name="ck_results_score_within_maximum"),
        CheckConstraint("percentage >= 0 AND percentage <= 100", name="ck_results_percentage_range"),
        CheckConstraint(
            "correct_count >= 0 AND incorrect_count >= 0 AND unanswered_count >= 0",
            name="ck_results_counts_non_negative",
        ),
    )

    attempt_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessment_attempts.id", ondelete="CASCADE"), nullable=False
    )
    #: Denormalised from the attempt so a candidate's results can be listed without joining twice.
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assessment_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True
    )

    #: Marks awarded, summed from the questions answered correctly.
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    #: Marks available, summed from the questions as they stood at evaluation.
    maximum_score: Mapped[int] = mapped_column(Integer, nullable=False)
    #: `score / maximum_score * 100`, to two decimal places. Exact decimal, not a float, so
    #: 87.5 stays 87.5 and no display rounds a fail up into a pass.
    percentage: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    #: The threshold this result was judged against, copied from the assessment at evaluation.
    passing_marks: Mapped[int] = mapped_column(Integer, nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)

    correct_count: Mapped[int] = mapped_column(Integer, nullable=False)
    incorrect_count: Mapped[int] = mapped_column(Integer, nullable=False)
    unanswered_count: Mapped[int] = mapped_column(Integer, nullable=False)

    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    attempt: Mapped["AssessmentAttempt"] = relationship(back_populates="result")
    candidate: Mapped["User"] = relationship()
    assessment: Mapped["Assessment"] = relationship()

    def __repr__(self) -> str:
        return f"<AttemptResult attempt={self.attempt_id} {self.score}/{self.maximum_score}>"
