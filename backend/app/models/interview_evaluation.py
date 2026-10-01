"""Phase 7B — the AI evaluation of one interview answer.

**An evaluation is an assessment signal for a human, not a decision.** It never hires, rejects, ranks or
ends anything, and it is never shown to the candidate. It is written only from validated, normalized
model output — never raw model text — and it never contains the model's reasoning trace.

One row per (answer, evaluator version, rubric version). A run that fails transiently is retried on the
same PENDING row (bounded); once COMPLETED a row is never changed. A future re-evaluation under a new
version is a new row, so an old evaluation stays interpretable under the rules it was made with.
"""

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin, utcnow


class EvaluationStatus(enum.StrEnum):
    #: Requested; a run may be in progress (`lease_until`).
    PENDING = "PENDING"
    #: Validated scores and findings recorded. Immutable.
    COMPLETED = "COMPLETED"
    #: The provider failed or returned unusable output, after bounded attempts. No score.
    FAILED = "FAILED"
    #: No evaluator is configured on this server. No score; the interview continued without one.
    UNAVAILABLE = "UNAVAILABLE"


class EvaluationFailure(enum.StrEnum):
    TIMEOUT = "TIMEOUT"
    RATE_LIMITED = "RATE_LIMITED"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    INVALID_OUTPUT = "INVALID_OUTPUT"
    INPUT_TOO_LONG = "INPUT_TOO_LONG"
    NOT_CONFIGURED = "NOT_CONFIGURED"


def _in(column: str, values: type[enum.StrEnum]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v.value}'" for v in values) + ")"


class InterviewEvaluation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "interview_evaluations"
    __table_args__ = (
        UniqueConstraint(
            "item_id", "evaluator_version", "rubric_version", name="uq_interview_evaluation_version"
        ),
        CheckConstraint(_in("status", EvaluationStatus), name="ck_interview_evaluations_status"),
        CheckConstraint(
            "failure_reason IS NULL OR " + _in("failure_reason", EvaluationFailure),
            name="ck_interview_evaluations_failure",
        ),
        CheckConstraint(
            "(status = 'COMPLETED') = (overall_score IS NOT NULL AND confidence IS NOT NULL "
            "AND dimension_scores IS NOT NULL AND completed_at IS NOT NULL)",
            name="ck_interview_evaluations_completed_iff_scored",
        ),
        CheckConstraint(
            "(status IN ('FAILED', 'UNAVAILABLE')) = (failure_reason IS NOT NULL)",
            name="ck_interview_evaluations_failed_iff_reason",
        ),
        CheckConstraint(
            "overall_score IS NULL OR overall_score BETWEEN 0 AND 100",
            name="ck_interview_evaluations_overall",
        ),
        CheckConstraint(
            "confidence IS NULL OR confidence BETWEEN 0 AND 1", name="ck_interview_evaluations_confidence"
        ),
        CheckConstraint("attempts BETWEEN 0 AND 3", name="ck_interview_evaluations_attempts"),
        CheckConstraint(
            "feedback IS NULL OR char_length(feedback) <= 600",
            name="ck_interview_evaluations_feedback_length",
        ),
    )

    item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_session_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("interview_questions.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[EvaluationStatus] = mapped_column(
        Enum(
            EvaluationStatus,
            name="interview_evaluation_status",
            native_enum=False,
            length=20,
            validate_strings=True,
        ),
        nullable=False,
    )
    failure_reason: Mapped[EvaluationFailure | None] = mapped_column(
        Enum(
            EvaluationFailure,
            name="interview_evaluation_failure",
            native_enum=False,
            length=20,
            validate_strings=True,
        ),
        nullable=True,
    )
    # -- provenance: which implementation produced this (never a secret) ------------------------
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    evaluator_version: Mapped[str] = mapped_column(String(40), nullable=False)
    rubric_id: Mapped[str] = mapped_column(String(40), nullable=False)
    rubric_version: Mapped[str] = mapped_column(String(40), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(40), nullable=False)
    # -- the validated result (COMPLETED only) ---------------------------------------------------
    #: `{dimension: 0–10}` for exactly the rubric's dimensions.
    dimension_scores: Mapped[dict[str, int] | None] = mapped_column(JSONB, nullable=True)
    #: 0–100, computed by the server from the dimension scores and the rubric's weights.
    overall_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: The model's self-reported confidence, 0–1. A signal, not a probability of being right.
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(3, 2), nullable=True)
    #: The question's own expected concepts, by text, as judged present / missing.
    present_concepts: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    missing_concepts: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    incorrect_points: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    strengths: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    #: Short passages of the candidate's answer the findings rest on — verified to occur in it.
    evidence_quotes: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Server-detected warnings (e.g. a high score despite missing concepts). For the reviewer.
    flags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    # -- operations -----------------------------------------------------------------------------
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def resolved(self) -> bool:
        return self.status is not EvaluationStatus.PENDING

    def details(self) -> dict[str, Any]:
        """Allow-listed facts for the audit log — never answer text, prompts or feedback."""
        return {
            "evaluation_id": str(self.id),
            "item_id": str(self.item_id),
            "status": self.status.value,
            "failure_reason": self.failure_reason.value if self.failure_reason else None,
            "overall_score": self.overall_score,
            "attempts": self.attempts,
            "provider": self.provider,
            "model": self.model,
            "evaluator_version": self.evaluator_version,
            "rubric_version": self.rubric_version,
        }
