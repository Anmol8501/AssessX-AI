import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.user import User


class AuditAction(enum.StrEnum):
    """Actions recorded in the audit log: Phase 6C review actions and Phase 7A interview actions.
    Other TRD §30 actions (sign-in, exam changes, evidence access) can be added here later."""

    REVIEW_STARTED = "REVIEW_STARTED"
    REVIEW_NOTE_ADDED = "REVIEW_NOTE_ADDED"
    REVIEW_EVIDENCE_MARKED = "REVIEW_EVIDENCE_MARKED"
    REVIEW_COMPLETED = "REVIEW_COMPLETED"
    REVIEW_REVISED = "REVIEW_REVISED"
    # Phase 7A — interview configuration (admin) and sessions (candidate).
    INTERVIEW_CREATED = "INTERVIEW_CREATED"
    INTERVIEW_UPDATED = "INTERVIEW_UPDATED"
    INTERVIEW_DELETED = "INTERVIEW_DELETED"
    INTERVIEW_PUBLISHED = "INTERVIEW_PUBLISHED"
    INTERVIEW_UNPUBLISHED = "INTERVIEW_UNPUBLISHED"
    INTERVIEW_QUESTION_CREATED = "INTERVIEW_QUESTION_CREATED"
    INTERVIEW_QUESTION_UPDATED = "INTERVIEW_QUESTION_UPDATED"
    INTERVIEW_QUESTION_DELETED = "INTERVIEW_QUESTION_DELETED"
    INTERVIEW_QUESTIONS_REORDERED = "INTERVIEW_QUESTIONS_REORDERED"
    INTERVIEW_ASSIGNED = "INTERVIEW_ASSIGNED"
    INTERVIEW_UNASSIGNED = "INTERVIEW_UNASSIGNED"
    INTERVIEW_SESSION_STARTED = "INTERVIEW_SESSION_STARTED"
    INTERVIEW_ANSWER_SUBMITTED = "INTERVIEW_ANSWER_SUBMITTED"
    INTERVIEW_SESSION_COMPLETED = "INTERVIEW_SESSION_COMPLETED"
    # Phase 7B — AI evaluation (an assessment signal) and the adaptive decisions made from it.
    INTERVIEW_EVALUATION_REQUESTED = "INTERVIEW_EVALUATION_REQUESTED"
    INTERVIEW_EVALUATION_COMPLETED = "INTERVIEW_EVALUATION_COMPLETED"
    INTERVIEW_EVALUATION_FAILED = "INTERVIEW_EVALUATION_FAILED"
    INTERVIEW_EVALUATION_RETRIED = "INTERVIEW_EVALUATION_RETRIED"
    INTERVIEW_ADAPTIVE_DECISION = "INTERVIEW_ADAPTIVE_DECISION"
    # Phase 7C — the human review of an interview.
    INTERVIEW_REVIEW_STARTED = "INTERVIEW_REVIEW_STARTED"
    INTERVIEW_REVIEW_NOTE_ADDED = "INTERVIEW_REVIEW_NOTE_ADDED"
    INTERVIEW_REVIEW_ANSWER_MARKED = "INTERVIEW_REVIEW_ANSWER_MARKED"
    INTERVIEW_REVIEW_COMPLETED = "INTERVIEW_REVIEW_COMPLETED"
    INTERVIEW_REVIEW_REVISED = "INTERVIEW_REVIEW_REVISED"
    # Phase 7D — the live video interview call.
    INTERVIEW_CALL_OPENED = "INTERVIEW_CALL_OPENED"
    INTERVIEW_CALL_JOINED = "INTERVIEW_CALL_JOINED"
    INTERVIEW_CALL_ENDED = "INTERVIEW_CALL_ENDED"
    INTERVIEW_CALL_NOTE_ADDED = "INTERVIEW_CALL_NOTE_ADDED"
    # Exam control — holding an attempt (automatically at the tab-switch limit, or by an admin).
    ATTEMPT_HELD = "ATTEMPT_HELD"
    ATTEMPT_RELEASED = "ATTEMPT_RELEASED"
    ATTEMPT_ENDED_BY_ADMIN = "ATTEMPT_ENDED_BY_ADMIN"
    # Coding assessments — the problem library (administrators).
    CODING_PROBLEM_CREATED = "CODING_PROBLEM_CREATED"
    CODING_PROBLEM_DELETED = "CODING_PROBLEM_DELETED"
    CODING_VERSION_CREATED = "CODING_VERSION_CREATED"
    CODING_VERSION_PUBLISHED = "CODING_VERSION_PUBLISHED"


class AuditLog(UUIDPrimaryKeyMixin, Base):
    """An append-only record of who did what, and when (TRD §5 `AuditLog`, §30).

    **Append-only at the database.** A trigger (migration 0014) rejects every UPDATE and DELETE, so
    no application path — or a bug in one — can rewrite history. This protects against the
    application, not against the database owner, who could drop the trigger; tamper-evidence (hash
    chaining) remains open decision OQ-12.

    **Survives what it describes.** `attempt_id` and `assessment_id` are plain ids, not foreign keys:
    deleting an assessment or unassigning a candidate cascades away the attempt and its review, but
    the record that a review happened, by whom and with what outcome, remains. `details` holds only
    allow-listed facts (statuses, outcome, revision, ids, lengths) — never note text, tokens or PII.
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        CheckConstraint(
            "action IN (" + ", ".join(f"'{a.value}'" for a in AuditAction) + ")", name="ck_audit_logs_action"
        ),
        Index("ix_audit_logs_attempt_occurred", "attempt_id", "occurred_at"),
        Index("ix_audit_logs_actor_occurred", "actor_id", "occurred_at"),
        Index("ix_audit_logs_interview_session_occurred", "interview_session_id", "occurred_at"),
    )

    actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[AuditAction] = mapped_column(
        Enum(AuditAction, name="audit_action", native_enum=False, length=40, validate_strings=True),
        nullable=False,
    )
    attempt_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    assessment_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    #: Phase 7A. Plain ids like `attempt_id`, so the record outlives what it describes.
    interview_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    interview_session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utcnow)

    actor: Mapped["User"] = relationship(lazy="joined")

    def __repr__(self) -> str:
        return f"<AuditLog {self.action} attempt={self.attempt_id}>"
