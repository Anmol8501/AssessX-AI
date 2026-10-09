import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Enum, ForeignKey, Index, String, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UUIDPrimaryKeyMixin, utcnow

if TYPE_CHECKING:
    from app.models.user import User


class AuditAction(enum.StrEnum):
    """Actions recorded in the audit log: Phase 6C review actions and Phase 7A interview actions.
    Other TRD §30 actions (sign-in, exam changes, evidence access) can be added here later."""

    #: A proctor sent the candidate a short message during the exam (its length only is recorded here).
    ATTEMPT_MESSAGE_SENT = "ATTEMPT_MESSAGE_SENT"
    # Phase 8A (AX-08) — accounts and sessions. Never a password, token, code or full email.
    SIGN_IN_SUCCEEDED = "SIGN_IN_SUCCEEDED"
    SIGN_IN_FAILED = "SIGN_IN_FAILED"
    SIGN_IN_THROTTLED = "SIGN_IN_THROTTLED"
    SIGNED_OUT = "SIGNED_OUT"
    SESSIONS_REVOKED = "SESSIONS_REVOKED"
    PASSWORD_CHANGED = "PASSWORD_CHANGED"  # noqa: S105 — an action name, not a password
    PASSWORD_RESET_ISSUED = "PASSWORD_RESET_ISSUED"  # noqa: S105 — an action name, not a password
    PASSWORD_RESET_COMPLETED = "PASSWORD_RESET_COMPLETED"  # noqa: S105 — an action name, not a password
    ACCOUNT_DEACTIVATED = "ACCOUNT_DEACTIVATED"
    ACCOUNT_REACTIVATED = "ACCOUNT_REACTIVATED"
    CANDIDATE_CREATED = "CANDIDATE_CREATED"
    # Phase 8A (AX-08) — exams. Field names and flags only; never question text or the answer key.
    ASSESSMENT_CREATED = "ASSESSMENT_CREATED"
    ASSESSMENT_UPDATED = "ASSESSMENT_UPDATED"
    ASSESSMENT_DELETED = "ASSESSMENT_DELETED"
    ASSESSMENT_MARKED_READY = "ASSESSMENT_MARKED_READY"
    ASSESSMENT_REVERTED_TO_DRAFT = "ASSESSMENT_REVERTED_TO_DRAFT"
    ASSESSMENT_PUBLISHED = "ASSESSMENT_PUBLISHED"
    ASSESSMENT_UNPUBLISHED = "ASSESSMENT_UNPUBLISHED"
    QUESTION_CREATED = "QUESTION_CREATED"
    QUESTION_UPDATED = "QUESTION_UPDATED"
    QUESTION_DELETED = "QUESTION_DELETED"
    CANDIDATE_ASSIGNED = "CANDIDATE_ASSIGNED"
    CANDIDATE_UNASSIGNED = "CANDIDATE_UNASSIGNED"
    # Phase 8A (AX-07) — one exam, one sign-in at a time.
    ATTEMPT_ACCESS_BLOCKED = "ATTEMPT_ACCESS_BLOCKED"
    ATTEMPT_SESSION_TAKEN_OVER = "ATTEMPT_SESSION_TAKEN_OVER"
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
    # Evidence clips (FR-017). EXPIRED and FAILED-by-sweep are the system's own actions (no actor).
    EVIDENCE_CLIP_CREATED = "EVIDENCE_CLIP_CREATED"
    EVIDENCE_CLIP_READY = "EVIDENCE_CLIP_READY"
    EVIDENCE_CLIP_FAILED = "EVIDENCE_CLIP_FAILED"
    EVIDENCE_CLIP_VIEWED = "EVIDENCE_CLIP_VIEWED"
    EVIDENCE_CLIP_VERIFIED = "EVIDENCE_CLIP_VERIFIED"
    EVIDENCE_CLIP_INTEGRITY_FAILED = "EVIDENCE_CLIP_INTEGRITY_FAILED"
    EVIDENCE_CLIP_DELETED = "EVIDENCE_CLIP_DELETED"
    EVIDENCE_CLIP_EXPIRED = "EVIDENCE_CLIP_EXPIRED"
    # Phase 8 final — admin MFA, the audit viewer, alerts and retention.
    MFA_ENABLED = "MFA_ENABLED"
    MFA_RECOVERY_USED = "MFA_RECOVERY_USED"
    MFA_RESET = "MFA_RESET"
    AUDIT_LOG_VIEWED = "AUDIT_LOG_VIEWED"
    AUDIT_CHAIN_VERIFIED = "AUDIT_CHAIN_VERIFIED"
    SECURITY_EVENTS_VIEWED = "SECURITY_EVENTS_VIEWED"
    SECURITY_ALERT_ACKNOWLEDGED = "SECURITY_ALERT_ACKNOWLEDGED"
    RETENTION_PURGED = "RETENTION_PURGED"


#: Actions that may have no actor: nobody identified yet, or the system acting on its own.
SYSTEM_ACTIONS = (
    AuditAction.SIGN_IN_FAILED,
    AuditAction.SIGN_IN_THROTTLED,
    AuditAction.EVIDENCE_CLIP_FAILED,
    AuditAction.EVIDENCE_CLIP_EXPIRED,
    AuditAction.RETENTION_PURGED,
    AuditAction.AUDIT_CHAIN_VERIFIED,
)


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
        CheckConstraint(
            "actor_id IS NOT NULL OR action IN (" + ", ".join(f"'{a.value}'" for a in SYSTEM_ACTIONS) + ")",
            name="ck_audit_logs_actor_required",
        ),
        Index("ix_audit_logs_attempt_occurred", "attempt_id", "occurred_at"),
        Index("ix_audit_logs_actor_occurred", "actor_id", "occurred_at"),
        Index("ix_audit_logs_interview_session_occurred", "interview_session_id", "occurred_at"),
        # The hash chain order (migration 0028).
        Index("ux_audit_logs_seq", "seq", unique=True),
    )

    #: Who acted. Empty only for a failed or throttled sign-in, where nobody has been identified, and for
    #: the system's own evidence actions (`SYSTEM_ACTIONS`; enforced by `ck_audit_logs_actor_required`).
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
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
    #: Where the action came from (Phase 8 final, CX-03): the request id and the trusted client address.
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    #: Tamper evidence (CX-11): a database trigger sets these on insert — `entry_hash` is SHA-256 over the
    #: previous row's hash and this row's canonical content, in `seq` order. Never set by the application.
    seq: Mapped[int | None] = mapped_column(BigInteger, nullable=True, server_default=None)
    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entry_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    actor: Mapped["User | None"] = relationship(lazy="joined")

    def __repr__(self) -> str:
        return f"<AuditLog {self.action} attempt={self.attempt_id}>"
