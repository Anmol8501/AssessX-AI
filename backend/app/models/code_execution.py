"""Code executions (coding assessments, stage C2): one row per Run, Submit or Validate request.

The table is also the job queue. The API inserts a QUEUED row; a runner claims it over HTTPS (`FOR UPDATE
SKIP LOCKED`, with a lease), runs it in its sandbox, and reports raw results; the API then decides every
verdict itself by comparing outputs with the expected answers it stores. The runner never sees the
database, and the candidate never sees hidden test data — `results` keeps per-test details for
administrators, and the candidate view is built from it with hidden tests reduced to counts.

* RUN — the candidate's code against the public tests (or their own input, if the assessment allows it).
* SUBMIT — against every test; what scoring will use (stage C4).
* VALIDATE — an administrator's check that the reference solution passes every test.
"""

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Integer, String, Text, Uuid, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.coding import CodingProblemVersion


class ExecutionKind(enum.StrEnum):
    RUN = "RUN"
    SUBMIT = "SUBMIT"
    VALIDATE = "VALIDATE"


class ExecutionStatus(enum.StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    #: The runner could not finish it (repeated lease expiry, infrastructure error). Never the
    #: candidate's fault, never scored as wrong.
    FAILED = "FAILED"


class Verdict(enum.StrEnum):
    ACCEPTED = "ACCEPTED"
    WRONG_ANSWER = "WRONG_ANSWER"
    COMPILATION_ERROR = "COMPILATION_ERROR"
    RUNTIME_ERROR = "RUNTIME_ERROR"
    TIME_LIMIT_EXCEEDED = "TIME_LIMIT_EXCEEDED"
    MEMORY_LIMIT_EXCEEDED = "MEMORY_LIMIT_EXCEEDED"
    OUTPUT_LIMIT_EXCEEDED = "OUTPUT_LIMIT_EXCEEDED"
    #: A RUN with the candidate's own input: there is no expected output, so nothing to judge.
    COMPLETED = "COMPLETED"
    SYSTEM_ERROR = "SYSTEM_ERROR"


_KINDS = "('RUN', 'SUBMIT', 'VALIDATE')"
_STATUSES = "('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')"


class CodeExecution(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "code_executions"
    __table_args__ = (
        CheckConstraint(f"kind IN {_KINDS}", name="ck_code_executions_kind"),
        CheckConstraint(f"status IN {_STATUSES}", name="ck_code_executions_status"),
        CheckConstraint("char_length(source) BETWEEN 1 AND 65536", name="ck_code_executions_source_size"),
        CheckConstraint(
            "custom_input IS NULL OR char_length(custom_input) <= 65536", name="ck_code_executions_input_size"
        ),
        # Candidate runs and submissions belong to an attempt and a question; validation does not.
        CheckConstraint(
            "(kind = 'VALIDATE') = (attempt_id IS NULL AND question_id IS NULL)",
            name="ck_code_executions_scope",
        ),
        CheckConstraint("claim_count >= 0", name="ck_code_executions_claims"),
        # A retried request with the same key returns the original execution.
        Index(
            "uq_code_executions_idempotency",
            "attempt_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("attempt_id IS NOT NULL"),
        ),
        Index("ix_code_executions_queue", "status", "created_at"),
        Index("ix_code_executions_attempt_question", "attempt_id", "question_id", "created_at"),
    )

    kind: Mapped[ExecutionKind] = mapped_column(
        Enum(ExecutionKind, name="execution_kind", native_enum=False, length=10, validate_strings=True),
        nullable=False,
    )
    status: Mapped[ExecutionStatus] = mapped_column(
        Enum(ExecutionStatus, name="execution_status", native_enum=False, length=10, validate_strings=True),
        nullable=False,
        default=ExecutionStatus.QUEUED,
    )
    verdict: Mapped[Verdict | None] = mapped_column(
        Enum(Verdict, name="execution_verdict", native_enum=False, length=25, validate_strings=True),
        nullable=True,
    )

    attempt_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("assessment_attempts.id", ondelete="CASCADE"), nullable=True
    )
    question_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("questions.id", ondelete="CASCADE"), nullable=True
    )
    #: The exact, immutable problem version executed against.
    problem_version_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("coding_problem_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    requested_by_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    language: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    custom_input: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)

    passed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total: Mapped[int | None] = mapped_column(Integer, nullable=True)
    passed_weight: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_weight: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: The slowest test's wall time, and the job's peak memory, as the runner measured them.
    runtime_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    memory_kb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    compile_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Per-test results (server-judged). Includes hidden tests — administrators only.
    results: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)

    claimed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claim_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    problem_version: Mapped[CodingProblemVersion] = relationship()

    @property
    def is_finished(self) -> bool:
        return self.status in (ExecutionStatus.COMPLETED, ExecutionStatus.FAILED)
