import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditAction, AuditLog
from app.models.base import utcnow


class AuditRepository:
    """The append-only audit log. There is deliberately no update or delete method — and the
    database rejects both anyway (migration 0014)."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def record(
        self,
        *,
        actor_id: uuid.UUID,
        action: AuditAction,
        attempt_id: uuid.UUID | None = None,
        assessment_id: uuid.UUID | None = None,
        interview_id: uuid.UUID | None = None,
        interview_session_id: uuid.UUID | None = None,
        details: dict[str, Any],
    ) -> AuditLog:
        """Written in the caller's transaction: the action and its record commit, or neither does."""
        row = AuditLog(
            actor_id=actor_id,
            action=action,
            attempt_id=attempt_id,
            assessment_id=assessment_id,
            interview_id=interview_id,
            interview_session_id=interview_session_id,
            details=details,
            occurred_at=utcnow(),
        )
        self.db.add(row)
        self.db.flush()
        return row

    def for_interview_session(self, session_id: uuid.UUID) -> list[AuditLog]:
        return list(
            self.db.scalars(
                select(AuditLog)
                .where(AuditLog.interview_session_id == session_id)
                .order_by(AuditLog.occurred_at, AuditLog.id)
            )
        )

    def for_attempt(self, attempt_id: uuid.UUID) -> list[AuditLog]:
        return list(
            self.db.scalars(
                select(AuditLog)
                .where(AuditLog.attempt_id == attempt_id)
                .order_by(AuditLog.occurred_at, AuditLog.id)
            )
        )
